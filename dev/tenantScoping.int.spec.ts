import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { collectionHasTenantField, tenantWhereClause } from '../src/utilities/tenantFilter.js'
import { buildMultiTenantPayload } from './helpers/multiTenantPayload.js'

let payload: Payload
let stop: () => Promise<void>
let tenantA: string
let tenantB: string
let tenantAResource: { id: number | string } & Record<string, unknown>
let tenantAService: { id: number | string } & Record<string, unknown>
let tenantAUser: {
  id: number | string
  tenants: Array<{ tenant: unknown }>
} & Record<string, unknown>
let tenantBResource: { id: number | string } & Record<string, unknown>
let tenantBService: { id: number | string } & Record<string, unknown>

beforeAll(async () => {
  const built = await buildMultiTenantPayload()
  payload = built.payload
  stop = built.stop

  const a = await payload.create({ collection: 'tenants', data: { name: 'Tenant A' } })
  const b = await payload.create({ collection: 'tenants', data: { name: 'Tenant B' } })
  tenantA = String(a.id)
  tenantB = String(b.id)

  tenantAResource = await payload.create({
    collection: 'resources',
    data: { name: 'A-res', tenant: tenantA } as Record<string, unknown>,
  })
  tenantBResource = await payload.create({
    collection: 'resources',
    data: { name: 'B-res', tenant: tenantB } as Record<string, unknown>,
  })

  tenantAService = await payload.create({
    collection: 'services',
    data: {
      name: 'A-service',
      duration: 30,
      durationType: 'fixed',
      tenant: tenantA,
    } as Record<string, unknown>,
  })
  tenantBService = await payload.create({
    collection: 'services',
    data: {
      name: 'B-service',
      duration: 30,
      durationType: 'fixed',
      tenant: tenantB,
    } as Record<string, unknown>,
  })

  // depth: 0 so `.tenants[0].tenant` comes back as a raw id, not a populated doc.
  //
  // Pass `a.id` (the RAW id), not the stringified `tenantA`, here specifically.
  // Confirmed empirically: a numeric-id adapter's relationship-field validation
  // coerces a stringified numeric id fine at the TOP level (e.g. resources.tenant,
  // above) but rejects it inside an ARRAY-nested relationship field
  // (`ValidationError: The following field is invalid: Tenants 1 > Tenant`) —
  // this is the one write in this file that must stay adapter-agnostic by using
  // whatever shape `payload.create` itself just returned.
  tenantAUser = (await payload.create({
    collection: 'users',
    data: {
      email: 'tenant-a-user@test.com',
      password: 'testpass123',
      tenants: [{ tenant: a.id }],
    } as Record<string, unknown>,
    depth: 0,
  })) as unknown as {
    id: number | string
    tenants: Array<{ tenant: unknown }>
  } & Record<string, unknown>
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('tenant scoping with the real multi-tenant plugin', () => {
  it('multi-tenant injected a tenant field into reservations and resources', () => {
    const resv = payload.config.collections.find((c) => c.slug === 'reservations')
    const res = payload.config.collections.find((c) => c.slug === 'resources')
    expect(collectionHasTenantField(resv, 'tenant')).toBe(true)
    expect(collectionHasTenantField(res, 'tenant')).toBe(true)
  })

  it('a non-multi-tenant collection (users) has no tenant field → no scoping', () => {
    const users = payload.config.collections.find((c) => c.slug === 'users')
    expect(collectionHasTenantField(users, 'tenant')).toBe(false)
    expect(tenantWhereClause({ hasField: false, tenantField: 'tenant', tenantId: tenantA })).toBeNull()
  })

  it('scopes payload.find to the selected tenant', async () => {
    const where = tenantWhereClause({ hasField: true, tenantField: 'tenant', tenantId: tenantA })
    const { docs } = await payload.find({ collection: 'resources', depth: 0, where: where! })
    expect(docs).toHaveLength(1)
    expect(String((docs[0] as Record<string, unknown>).tenant)).toBe(tenantA)
  })

  it('returns all tenants when no tenant is selected (no cookie)', async () => {
    expect(tenantWhereClause({ hasField: true, tenantField: 'tenant', tenantId: null })).toBeNull()
    const { docs } = await payload.find({ collection: 'resources', depth: 0 })
    expect(docs.length).toBeGreaterThanOrEqual(2)
  })
})

describe('cross-tenant create via /reserve/book', () => {
  // slugs.customers must mirror the userCollection wiring plugin.ts does at
  // boot (resolveConfig alone does not apply it) — otherwise `user.collection
  // ('users') !== slugs.customers ('customers')` misclassifies our ordinary
  // authenticated user as privileged staff, which changes which code path the
  // endpoint takes before the tenant check is even reached.
  const resolved = resolveConfig({ slugs: { customers: 'users' }, userCollection: 'users' })

  it('an authenticated tenant-A caller cannot create a booking in tenant B (string id)', async () => {
    const endpoint = createBookingEndpoint(resolved)

    // resource/service both genuinely belong to tenant B (MT auto-injects
    // filterOptions on any relationship field pointing at a tenant-scoped
    // collection, keyed off the submitted `tenant` value — an internally
    // inconsistent combination would be rejected as an "invalid selection"
    // before the access question is ever reached, masking the thing under
    // test). The exploit is tenantAUser, who has no membership in tenant B at
    // all, planting a reservation there anyway by supplying `tenant: tenantB`
    // explicitly.
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          resource: tenantBResource.id,
          service: tenantBService.id,
          startTime: '2027-07-01T10:00:00.000Z',
          tenant: tenantB,
        }),
      payload,
      user: { ...tenantAUser, collection: 'users' },
    } as never)

    // Assert the exact refusal, not merely "some 4xx" — an unrelated 400 (a
    // wrong-reason failure, the same trap the RED test for this fix tripped
    // twice) would satisfy a looser `>= 400` assertion just as well as the
    // genuine 403 the tenant probe returns.
    expect(res.status).toBe(403)
    const { totalDocs } = await payload.count({
      collection: 'reservations',
      where: { tenant: { equals: tenantB } },
    })
    expect(totalDocs).toBe(0)
  })

  it('an authenticated tenant-A caller cannot create a booking in tenant B (object-shaped id)', async () => {
    const endpoint = createBookingEndpoint(resolved)

    // A populated relationship — `{ "tenant": { "id": "<tenantB>" } }` — is a
    // shape Payload itself normalizes internally (beforeValidate) and a real
    // client can send. A guard that only recognizes a bare string id would
    // skip the probe entirely for this shape and let the write through.
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          resource: tenantBResource.id,
          service: tenantBService.id,
          startTime: '2027-07-01T11:00:00.000Z',
          tenant: { id: tenantB },
        }),
      payload,
      user: { ...tenantAUser, collection: 'users' },
    } as never)

    expect(res.status).toBe(403)
    const { totalDocs } = await payload.count({
      collection: 'reservations',
      where: { tenant: { equals: tenantB } },
    })
    expect(totalDocs).toBe(0)
  })

  // Positive control: the tenant-membership probe that rejects the cases above
  // must not also reject a legitimate same-tenant booking — otherwise the fix
  // would trade one bug (cross-tenant writes) for another (booking broken for
  // everyone under multiTenant).
  it('an authenticated tenant-A caller can still create a booking in their own tenant', async () => {
    const endpoint = createBookingEndpoint(resolved)

    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          resource: tenantAResource.id,
          service: tenantAService.id,
          startTime: '2027-07-02T10:00:00.000Z',
          tenant: tenantA,
        }),
      payload,
      user: { ...tenantAUser, collection: 'users' },
    } as never)

    expect(res.status).toBe(201)
    const created = (await res.json()) as { tenant?: unknown }
    const tenantId =
      typeof created.tenant === 'object' && created.tenant
        ? (created.tenant as { id: unknown }).id
        : created.tenant
    expect(String(tenantId)).toBe(tenantA)
  })
})

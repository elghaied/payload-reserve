import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildCustomerScopedPayload } from './helpers/customerScopedPayload.js'

let payload: Payload
let stop: () => Promise<void>
let tenantA: string
let tenantB: string
let staffA: Record<string, unknown>
let staffB: Record<string, unknown>
let superAdmin: Record<string, unknown>
let handler: Endpoint['handler']

const callSearch = (args: {
  cookie?: string
  search?: string
  user: Record<string, unknown>
}) => {
  const params = new URLSearchParams({ limit: '50', search: args.search ?? '' })
  const req = {
    headers: new Headers(args.cookie ? { cookie: args.cookie } : {}),
    payload,
    url: `http://localhost:3000/api/reservation-customer-search?${params.toString()}`,
    user: { ...args.user, collection: 'users' },
  } as unknown as PayloadRequest
  return handler(req)
}

const emailsFrom = async (res: Response): Promise<string[]> => {
  const body = (await res.json()) as { docs: Array<{ email?: string }> }
  return body.docs.map((d) => d.email ?? '')
}

beforeAll(async () => {
  const built = await buildCustomerScopedPayload()
  payload = built.payload
  stop = built.stop

  const ep = payload.config.endpoints?.find((e) => e.path === '/reservation-customer-search')
  if (!ep) {
    throw new Error('customer-search endpoint not registered')
  }
  handler = ep.handler

  const a = await payload.create({ collection: 'tenants', data: { name: 'Tenant A' } })
  const b = await payload.create({ collection: 'tenants', data: { name: 'Tenant B' } })
  tenantA = String(a.id)
  tenantB = String(b.id)

  // Real users with real tenant memberships. withTenantAccess reads
  // user.tenants[].tenant — a synthetic user object with no memberships
  // produces an EMPTY constraint and denies everything, which would make an
  // isolation test pass for entirely the wrong reason.
  staffA = (await payload.create({
    collection: 'users',
    data: { email: 'staff-a@test.com', password: 'testpass123', tenants: [{ tenant: tenantA }] },
  })) as unknown as Record<string, unknown>
  staffB = (await payload.create({
    collection: 'users',
    data: { email: 'staff-b@test.com', password: 'testpass123', tenants: [{ tenant: tenantB }] },
  })) as unknown as Record<string, unknown>
  superAdmin = (await payload.create({
    collection: 'users',
    data: { email: 'super@test.com', password: 'testpass123', superAdmin: true },
  })) as unknown as Record<string, unknown>

  await payload.create({
    collection: 'customers',
    data: {
      email: 'alice@a.test',
      firstName: 'Alice',
      lastName: 'A',
      password: 'testpass123',
      tenant: tenantA,
    } as Record<string, unknown>,
  })
  await payload.create({
    collection: 'customers',
    data: {
      email: 'bob@b.test',
      firstName: 'Bob',
      lastName: 'B',
      password: 'testpass123',
      tenant: tenantB,
    } as Record<string, unknown>,
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('customer search — tenant scoping', () => {
  it('multi-tenant injected a tenant field into customers', () => {
    const customers = payload.config.collections.find((c) => c.slug === 'customers')
    const hasTenant = customers?.fields.some(
      (f) =>
        typeof f === 'object' && f !== null && 'name' in f && (f as { name?: string }).name === 'tenant',
    )
    expect(hasTenant).toBe(true)
  })

  it('returns the caller own-tenant customers', async () => {
    const emails = await emailsFrom(await callSearch({ user: staffA }))
    expect(emails).toContain('alice@a.test')
  })

  it('does NOT return another tenant customers even with no cookie set', async () => {
    const emails = await emailsFrom(await callSearch({ user: staffA }))
    expect(emails).not.toContain('bob@b.test')
  })

  it('scopes to the other tenant for that tenant staff', async () => {
    const emails = await emailsFrom(await callSearch({ user: staffB }))
    expect(emails).toContain('bob@b.test')
    expect(emails).not.toContain('alice@a.test')
  })

  it('ignores a forged cookie for a tenant the caller does not belong to', async () => {
    const emails = await emailsFrom(await callSearch({ cookie: `payload-tenant=${tenantB}`, user: staffA }))
    expect(emails).not.toContain('bob@b.test')
  })

  it('still narrows to the selected tenant for a multi-tenant super admin', async () => {
    const all = await emailsFrom(await callSearch({ user: superAdmin }))
    expect(all).toEqual(expect.arrayContaining(['alice@a.test', 'bob@b.test']))

    const narrowed = await emailsFrom(
      await callSearch({ cookie: `payload-tenant=${tenantA}`, user: superAdmin }),
    )
    expect(narrowed).toContain('alice@a.test')
    expect(narrowed).not.toContain('bob@b.test')
  })
})

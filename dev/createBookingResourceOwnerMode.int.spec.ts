import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { buildServiceResourcesAccessPayload } from './helpers/serviceResourcesAccessPayload.js'

// Maintainer ruling verification: under resourceOwnerMode, reservation `create`
// access is admin-only (makeReservationOwnerAccess, src/utilities/ownerAccess.ts)
// — a plain, non-admin CUSTOMER trips it, and so does a non-admin STAFF/owner
// account. The ruling is that the access-checked tenant probe, not
// `overrideAccess`, is /reserve/book's security boundary; applied consistently,
// that means the create stays privileged for EVERY caller and the probe runs for
// every authenticated one. These cases pin both halves of that: self-service
// booking and non-admin staff walk-in booking both keep working, while the
// force-onto-own-id guard still confines a customer to themselves.
let payload: Payload
let stop: () => Promise<void>
let owner: { id: number | string }

beforeAll(async () => {
  const built = await buildServiceResourcesAccessPayload()
  payload = built.payload
  stop = built.stop
  // Resources' `owner` field is required under resourceOwnerMode and its
  // beforeChange hook stamps it from req.user on create — so every resource
  // below is created "as" this user (a plain non-admin staff account; only
  // the reservation-side adminOnly rule under test cares about `role`).
  owner = await payload.create({
    collection: 'users',
    data: { email: 'rom-owner@test.com', password: 'testpass123' },
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

// Mirrors the resourceOwnerMode config buildServiceResourcesAccessPayload
// boots the real Payload instance with — resolveConfig alone doesn't affect
// the already-built collection's access function, so this must match exactly
// for the endpoint's own overrideAccess/isPrivilegedUser reasoning to line up
// with what the live collection will actually enforce.
const resolved = resolveConfig({
  resourceOwnerMode: { adminRoles: ['admin'], ownerCollection: 'users', roleField: 'role' },
})

describe('createBooking under resourceOwnerMode — customer self-booking', () => {
  it('an authenticated non-admin customer can still book for themselves', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'ROM Cut', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'ROM Chair', quantity: 1, services: [service.id] },
      user: owner,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'rom-customer@test.com',
        firstName: 'ROM',
        lastName: 'Customer',
        password: 'testpass123',
      },
    })

    const endpoint = createBookingEndpoint(resolved)
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          resource: resource.id,
          service: service.id,
          startTime: '2027-08-01T10:00:00.000Z',
        }),
      payload,
      user: { ...customer, collection: 'customers' },
    } as never)

    const body = (await res.clone().json()) as { customer?: unknown }
    expect(res.status, JSON.stringify(body)).toBe(201)
    const customerId =
      typeof body.customer === 'object' && body.customer
        ? (body.customer as { id: unknown }).id
        : body.customer
    expect(String(customerId)).toBe(String(customer.id))
  })

  it('the same customer cannot book on behalf of a DIFFERENT customer (still forced onto self)', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'ROM Cut 2', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'ROM Chair 2', quantity: 1, services: [service.id] },
      user: owner,
    })
    const customerA = await payload.create({
      collection: 'customers',
      data: {
        email: 'rom-a@test.com',
        firstName: 'ROM',
        lastName: 'A',
        password: 'testpass123',
      },
    })
    const customerB = await payload.create({
      collection: 'customers',
      data: {
        email: 'rom-b@test.com',
        firstName: 'ROM',
        lastName: 'B',
        password: 'testpass123',
      },
    })

    const endpoint = createBookingEndpoint(resolved)
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          customer: customerB.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-08-01T11:00:00.000Z',
        }),
      payload,
      user: { ...customerA, collection: 'customers' },
    } as never)

    expect(res.status).toBe(201)
    const body = (await res.json()) as { customer?: unknown }
    const customerId =
      typeof body.customer === 'object' && body.customer
        ? (body.customer as { id: unknown }).id
        : body.customer
    expect(String(customerId)).toBe(String(customerA.id))
  })

  it('a NON-ADMIN staff/owner may book a walk-in for another customer', async () => {
    // The gap the "genuine admin" case below cannot see. `isPrivilegedUser`
    // returns true for ANY user outside `slugs.customers`, so a plain staff or
    // resource-owner account (no `admin` role) took the same branch an admin
    // does. While that branch delegated collection access, this caller hit
    // makeReservationOwnerAccess's admin-only reservation `create` rule and got
    // a flat 403 — for a walk-in booking that worked in every release before
    // resourceOwnerMode-aware overrideAccess was introduced. The write is now
    // privileged for every caller and the tenant probe is the boundary, so this
    // must succeed.
    const service = await payload.create({
      collection: 'services',
      data: { name: 'ROM Cut Staff', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'ROM Chair Staff', quantity: 1, services: [service.id] },
      user: owner,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'rom-staff-walkin@test.com',
        firstName: 'ROM',
        lastName: 'StaffWalkin',
        password: 'testpass123',
      },
    })

    // `owner` is a users-collection account with NO role — staff, not admin.
    const endpoint = createBookingEndpoint(resolved)
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-08-02T09:00:00.000Z',
        }),
      payload,
      user: { ...owner, collection: 'users' },
    } as never)

    const body = (await res.clone().json()) as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(201)
    const customerId =
      typeof body.customer === 'object' && body.customer
        ? (body.customer as { id: unknown }).id
        : body.customer
    // The walk-in stayed the walk-in — a privileged caller is not forced onto
    // their own id.
    expect(String(customerId)).toBe(String(customer.id))
  })

  it('a genuine admin may still book on behalf of any customer', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'ROM Cut 3', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'ROM Chair 3', quantity: 1, services: [service.id] },
      user: owner,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'rom-walkin@test.com',
        firstName: 'ROM',
        lastName: 'Walkin',
        password: 'testpass123',
      },
    })
    const admin = await payload.create({
      collection: 'users',
      data: { email: 'rom-admin@test.com', password: 'testpass123', role: 'admin' },
    })

    const endpoint = createBookingEndpoint(resolved)
    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-08-01T12:00:00.000Z',
        }),
      payload,
      user: { ...admin, collection: 'users' },
    } as never)

    const body = (await res.clone().json()) as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(201)
  })
})

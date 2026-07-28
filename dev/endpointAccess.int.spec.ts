import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fetchDashboardStats } from '../src/components/DashboardWidget/fetchDashboardStats.js'
import { buildCustomerScopedPayload } from './helpers/customerScopedPayload.js'

// Reuses the customer-scoped harness: payloadReserve in standalone mode (so a
// `users`-collection caller is privileged by collection, with no roles needed)
// plus the real multi-tenant plugin scoping resources/reservations.
let payload: Payload
let stop: () => Promise<void>
let tenantA: string
let tenantB: string
let staffA: Record<string, unknown>
let staffB: Record<string, unknown>
let resourceA: { id: number | string }
let availabilityHandler: Endpoint['handler']

const endpoint = (path: string): Endpoint['handler'] => {
  const ep = payload.config.endpoints?.find((e) => e.path === path)
  if (!ep) {
    throw new Error(`endpoint not registered: ${path}`)
  }
  return ep.handler
}

const makeReq = (args: { url: string; user?: Record<string, unknown> }): PayloadRequest =>
  ({
    headers: new Headers(),
    payload,
    url: args.url,
    user: args.user ? { ...args.user, collection: 'users' } : null,
  }) as unknown as PayloadRequest

beforeAll(async () => {
  const built = await buildCustomerScopedPayload()
  payload = built.payload
  stop = built.stop
  availabilityHandler = endpoint('/reserve/resource-availability')

  const a = await payload.create({ collection: 'tenants', data: { name: 'Tenant A' } })
  const b = await payload.create({ collection: 'tenants', data: { name: 'Tenant B' } })
  tenantA = String(a.id)
  tenantB = String(b.id)

  staffA = (await payload.create({
    collection: 'users',
    data: { email: 'ra-a@test.com', password: 'testpass123', tenants: [{ tenant: tenantA }] },
  })) as unknown as Record<string, unknown>
  staffB = (await payload.create({
    collection: 'users',
    data: { email: 'ra-b@test.com', password: 'testpass123', tenants: [{ tenant: tenantB }] },
  })) as unknown as Record<string, unknown>

  resourceA = await payload.create({
    collection: 'resources',
    data: { name: 'Chair A', quantity: 1, tenant: tenantA } as Record<string, unknown>,
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

const availabilityUrl = (resourceId: number | string) => {
  const start = new Date('2026-09-01T00:00:00.000Z').toISOString()
  const end = new Date('2026-09-03T00:00:00.000Z').toISOString()
  const params = new URLSearchParams({ end, resource: String(resourceId), start })
  return `http://localhost:3000/api/reserve/resource-availability?${params.toString()}`
}

describe('resource-availability — per-resource authorization (A3)', () => {
  it('serves the grid to a caller in the resource own tenant', async () => {
    const res = await availabilityHandler(
      makeReq({ url: availabilityUrl(resourceA.id), user: staffA }),
    )
    expect(res.status).toBe(200)
  })

  it('refuses a caller from another tenant', async () => {
    const res = await availabilityHandler(
      makeReq({ url: availabilityUrl(resourceA.id), user: staffB }),
    )
    expect(res.status).toBe(404)
  })

  it('still refuses an unauthenticated caller', async () => {
    const res = await availabilityHandler(makeReq({ url: availabilityUrl(resourceA.id) }))
    expect(res.status).toBe(401)
  })
})

describe('cancel — privileged non-owner delegates to access control (A5)', () => {
  let reservationId: number | string
  let cancelHandler: Endpoint['handler']

  beforeAll(async () => {
    cancelHandler = endpoint('/reserve/cancel')

    const service = await payload.create({
      collection: 'services',
      data: { name: 'Cut A', duration: 30, durationType: 'fixed', tenant: tenantA } as Record<
        string,
        unknown
      >,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'cancel-a@test.com',
        firstName: 'Cancel',
        lastName: 'A',
        password: 'testpass123',
        tenant: tenantA,
      } as Record<string, unknown>,
    })
    const reservation = await payload.create({
      collection: 'reservations',
      data: {
        customer: customer.id,
        resource: resourceA.id,
        service: service.id,
        startTime: new Date(Date.now() + 96 * 3600_000).toISOString(),
        tenant: tenantA,
      } as Record<string, unknown>,
    })
    reservationId = reservation.id
  }, 60_000)

  const cancelAs = (user: Record<string, unknown>) => {
    const req = {
      headers: new Headers(),
      json: () => Promise.resolve({ reservationId: String(reservationId) }),
      payload,
      url: 'http://localhost:3000/api/reserve/cancel',
      user: { ...user, collection: 'users' },
    } as unknown as PayloadRequest
    return cancelHandler(req)
  }

  it('refuses a privileged caller from another tenant', async () => {
    const res = await cancelAs(staffB)
    expect(res.status).toBe(403)
  })

  it('allows a privileged caller in the reservation own tenant', async () => {
    const res = await cancelAs(staffA)
    expect(res.status).toBe(200)
  })
})

describe('effective-timezone — tenant membership is enforced (A7)', () => {
  let tzHandler: Endpoint['handler']

  beforeAll(async () => {
    tzHandler = endpoint('/reserve/effective-timezone')
    await payload.update({
      id: tenantB,
      collection: 'tenants',
      data: { timezone: 'Pacific/Auckland' } as Record<string, unknown>,
    })
  }, 60_000)

  const timezoneFor = async (user: Record<string, unknown>, cookieTenant: string) => {
    const req = {
      headers: new Headers({ cookie: `payload-tenant=${cookieTenant}` }),
      payload,
      url: 'http://localhost:3000/api/reserve/effective-timezone',
      user: { ...user, collection: 'users' },
    } as unknown as PayloadRequest
    const res = await tzHandler(req)
    const body = (await res.json()) as { timeZone: string }
    return body.timeZone
  }

  it('resolves the tenant zone for a member', async () => {
    expect(await timezoneFor(staffB, tenantB)).toBe('Pacific/Auckland')
  })

  it('falls back to the global zone for a forged cookie', async () => {
    expect(await timezoneFor(staffA, tenantB)).toBe('UTC')
  })
})

describe('dashboard stats — aggregates scope to the caller (A6)', () => {
  // A fixed absolute window, deliberately far from every other reservation in
  // this file, so the counts cannot be polluted by neighbouring describes.
  const START = '2027-05-04T10:00:00.000Z'
  const WINDOW_FROM = '2027-05-04T00:00:00.000Z'
  const WINDOW_TO = '2027-05-05T00:00:00.000Z'

  let base: {
    blockingStatuses: string[]
    now: Date
    payload: Payload
    reservationsSlug: string
    terminalStatuses: string[]
    where: Where
  }

  beforeAll(async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Stats A', duration: 30, durationType: 'fixed', tenant: tenantA } as Record<
        string,
        unknown
      >,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'stats-a@test.com',
        firstName: 'Stats',
        lastName: 'A',
        password: 'testpass123',
        tenant: tenantA,
      } as Record<string, unknown>,
    })
    await payload.create({
      collection: 'reservations',
      data: {
        customer: customer.id,
        resource: resourceA.id,
        service: service.id,
        startTime: START,
        tenant: tenantA,
      } as Record<string, unknown>,
    })

    base = {
      blockingStatuses: ['pending', 'confirmed'],
      now: new Date('2027-05-04T00:00:00.000Z'),
      payload,
      reservationsSlug: 'reservations',
      terminalStatuses: ['completed', 'cancelled', 'no-show'],
      where: { startTime: { greater_than_equal: WINDOW_FROM, less_than: WINDOW_TO } },
    }
  }, 60_000)

  const statsFor = (user: Record<string, unknown>) =>
    fetchDashboardStats({
      ...base,
      req: {
        headers: new Headers(),
        payload,
        user: { ...user, collection: 'users' },
      } as unknown as PayloadRequest,
    })

  it('counts the reservation for a caller in its tenant', async () => {
    const stats = await statsFor(staffA)
    expect(stats.total).toBe(1)
    expect(stats.upcoming).toBe(1)
    expect(stats.nextAppointment).toBeDefined()
  })

  it('counts nothing for a caller in another tenant', async () => {
    const stats = await statsFor(staffB)
    expect(stats.total).toBe(0)
    expect(stats.upcoming).toBe(0)
    expect(stats.nextAppointment).toBeUndefined()
  })
})

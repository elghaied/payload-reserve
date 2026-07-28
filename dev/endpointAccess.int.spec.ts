import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

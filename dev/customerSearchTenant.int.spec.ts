import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildCustomerScopedPayload } from './helpers/customerScopedPayload.js'

let payload: Payload
let stop: () => Promise<void>
let tenantA: string
let tenantB: string
let handler: Endpoint['handler']

const callSearch = (args: { cookie?: string; search?: string }) => {
  const params = new URLSearchParams({ limit: '50', search: args.search ?? '' })
  const req = {
    headers: new Headers(args.cookie ? { cookie: args.cookie } : {}),
    payload,
    url: `http://localhost:3000/api/reservation-customer-search?${params.toString()}`,
    user: { id: 'admin', collection: 'users' },
  } as unknown as PayloadRequest
  return handler(req)
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

  await payload.create({
    collection: 'customers',
    data: { email: 'alice@a.test', firstName: 'Alice', lastName: 'A', password: 'testpass123', tenant: tenantA } as Record<string, unknown>,
  })
  await payload.create({
    collection: 'customers',
    data: { email: 'bob@b.test', firstName: 'Bob', lastName: 'B', password: 'testpass123', tenant: tenantB } as Record<string, unknown>,
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('customer search — tenant scoping (E1)', () => {
  it('multi-tenant injected a tenant field into customers', () => {
    const customers = payload.config.collections.find((c) => c.slug === 'customers')
    const hasTenant = customers?.fields.some(
      (f) => typeof f === 'object' && f !== null && 'name' in f && (f as { name?: string }).name === 'tenant',
    )
    expect(hasTenant).toBe(true)
  })

  it('returns only the selected tenant customers when a tenant cookie is set', async () => {
    const res = await callSearch({ cookie: `payload-tenant=${tenantA}` })
    const body = await res.json()
    const emails = (body.docs as Array<{ email?: string }>).map((d) => d.email)
    expect(emails).toContain('alice@a.test')
    expect(emails).not.toContain('bob@b.test')
  })

  it('returns customers across tenants when no tenant cookie is set', async () => {
    const res = await callSearch({})
    const body = await res.json()
    const emails = (body.docs as Array<{ email?: string }>).map((d) => d.email)
    expect(emails).toEqual(expect.arrayContaining(['alice@a.test', 'bob@b.test']))
  })
})

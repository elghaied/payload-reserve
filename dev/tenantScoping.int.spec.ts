import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collectionHasTenantField, tenantWhereClause } from '../src/utilities/tenantFilter.js'
import { buildMultiTenantPayload } from './helpers/multiTenantPayload.js'

let payload: Payload
let stop: () => Promise<void>
let tenantA: string
let tenantB: string

beforeAll(async () => {
  const built = await buildMultiTenantPayload()
  payload = built.payload
  stop = built.stop

  const a = await payload.create({ collection: 'tenants', data: { name: 'Tenant A' } })
  const b = await payload.create({ collection: 'tenants', data: { name: 'Tenant B' } })
  tenantA = String(a.id)
  tenantB = String(b.id)

  await payload.create({
    collection: 'resources',
    data: { name: 'A-res', tenant: tenantA } as Record<string, unknown>,
  })
  await payload.create({
    collection: 'resources',
    data: { name: 'B-res', tenant: tenantB } as Record<string, unknown>,
  })
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

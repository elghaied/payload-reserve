import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getEffectiveTenantTimezone } from '../src/utilities/tenantTimezone.js'
import { buildMultiTenantPayload } from './helpers/multiTenantPayload.js'

let payload: Payload
let stop: () => Promise<void>
let tenantParis: string
let tenantNY: string
let tenantNoTz: string

beforeAll(async () => {
  const built = await buildMultiTenantPayload()
  payload = built.payload
  stop = built.stop

  const paris = await payload.create({
    collection: 'tenants',
    data: { name: 'Paris Co', timezone: 'Europe/Paris' },
  })
  const ny = await payload.create({
    collection: 'tenants',
    data: { name: 'NY Co', timezone: 'America/New_York' },
  })
  const noTz = await payload.create({ collection: 'tenants', data: { name: 'No TZ Co' } })
  tenantParis = String(paris.id)
  tenantNY = String(ny.id)
  tenantNoTz = String(noTz.id)
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('getEffectiveTenantTimezone against the real multi-tenant schema', () => {
  // The reservations collection is where the multi-tenant plugin injected the
  // `tenant` relationship — the resolver derives the tenants slug from it.
  const scoped = () => payload.config.collections.find((c) => c.slug === 'reservations')

  const resolve = (tenantId: null | string) =>
    getEffectiveTenantTimezone({
      globalTimezone: 'UTC',
      payload,
      scopedCollection: scoped(),
      tenantField: 'tenant',
      tenantId,
      timezoneField: 'timezone',
    })

  it("resolves each tenant's own timezone", async () => {
    expect(await resolve(tenantParis)).toBe('Europe/Paris')
    expect(await resolve(tenantNY)).toBe('America/New_York')
  })

  it('falls back to the global default when the tenant has no timezone value', async () => {
    expect(await resolve(tenantNoTz)).toBe('UTC')
  })

  it('falls back to the global default when no tenant is selected', async () => {
    expect(await resolve(null)).toBe('UTC')
  })

  it('falls back to the global default (no throw) for an unknown tenant id', async () => {
    expect(await resolve('64b9f0000000000000000000')).toBe('UTC')
  })

  it('honours a non-UTC global default for tenants without a timezone', async () => {
    expect(
      await getEffectiveTenantTimezone({
        globalTimezone: 'Asia/Tokyo',
        payload,
        scopedCollection: scoped(),
        tenantField: 'tenant',
        tenantId: tenantNoTz,
        timezoneField: 'timezone',
      }),
    ).toBe('Asia/Tokyo')
  })
})

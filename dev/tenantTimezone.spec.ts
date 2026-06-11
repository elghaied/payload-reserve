import { describe, expect, it, vi } from 'vitest'

import {
  getEffectiveTenantTimezone,
  resolveTenantTimezone,
  tenantCollectionSlug,
} from '../src/utilities/tenantTimezone.js'

describe('resolveTenantTimezone (pure precedence)', () => {
  it('prefers the tenant zone when valid', () => {
    expect(
      resolveTenantTimezone({ globalTimezone: 'UTC', tenantTimezone: 'Europe/Paris' }),
    ).toBe('Europe/Paris')
  })

  it('falls back to the global zone when the tenant zone is missing', () => {
    expect(resolveTenantTimezone({ globalTimezone: 'America/New_York' })).toBe('America/New_York')
    expect(
      resolveTenantTimezone({ globalTimezone: 'America/New_York', tenantTimezone: null }),
    ).toBe('America/New_York')
  })

  it('falls back to the global zone when the tenant zone is invalid', () => {
    expect(
      resolveTenantTimezone({ globalTimezone: 'America/New_York', tenantTimezone: 'Mars/Olympus' }),
    ).toBe('America/New_York')
  })

  it('falls back to UTC when both are missing or invalid', () => {
    expect(resolveTenantTimezone({ globalTimezone: '' })).toBe('UTC')
    expect(
      resolveTenantTimezone({ globalTimezone: 'Nope/Nope', tenantTimezone: 'Also/Bad' }),
    ).toBe('UTC')
  })
})

describe('tenantCollectionSlug', () => {
  it('reads the relationTo slug off the tenant relationship field', () => {
    const collection = {
      fields: [
        { name: 'title', type: 'text' },
        { name: 'tenant', type: 'relationship', relationTo: 'tenants' },
      ],
    }
    expect(tenantCollectionSlug(collection, 'tenant')).toBe('tenants')
  })

  it('returns null when the field is absent, polymorphic, or non-relationship', () => {
    expect(tenantCollectionSlug({ fields: [{ name: 'title', type: 'text' }] }, 'tenant')).toBeNull()
    expect(
      tenantCollectionSlug(
        { fields: [{ name: 'tenant', type: 'relationship', relationTo: ['a', 'b'] }] },
        'tenant',
      ),
    ).toBeNull()
    expect(tenantCollectionSlug(null, 'tenant')).toBeNull()
    expect(tenantCollectionSlug(undefined, 'tenant')).toBeNull()
  })
})

describe('getEffectiveTenantTimezone (DB-backed)', () => {
  const scopedCollection = {
    fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
  }

  it('loads the tenant doc and returns its timezone', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue({ id: 't1', timezone: 'Europe/Paris' }),
    }
    const tz = await getEffectiveTenantTimezone({
      globalTimezone: 'UTC',
      payload: payload as never,
      scopedCollection,
      tenantField: 'tenant',
      tenantId: 't1',
      timezoneField: 'timezone',
    })
    expect(tz).toBe('Europe/Paris')
    expect(payload.findByID).toHaveBeenCalledWith({ id: 't1', collection: 'tenants', depth: 0 })
  })

  it('falls back to the global zone when no tenant is selected (no DB read)', async () => {
    const payload = { findByID: vi.fn() }
    const tz = await getEffectiveTenantTimezone({
      globalTimezone: 'America/New_York',
      payload: payload as never,
      scopedCollection,
      tenantField: 'tenant',
      tenantId: null,
      timezoneField: 'timezone',
    })
    expect(tz).toBe('America/New_York')
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('falls back to the global zone when the tenant doc has no timezone value', async () => {
    const payload = { findByID: vi.fn().mockResolvedValue({ id: 't1' }) }
    const tz = await getEffectiveTenantTimezone({
      globalTimezone: 'America/New_York',
      payload: payload as never,
      scopedCollection,
      tenantField: 'tenant',
      tenantId: 't1',
      timezoneField: 'timezone',
    })
    expect(tz).toBe('America/New_York')
  })

  it('falls back to the global zone (no throw) when the tenant lookup fails', async () => {
    const payload = { findByID: vi.fn().mockRejectedValue(new Error('not found')) }
    const tz = await getEffectiveTenantTimezone({
      globalTimezone: 'America/New_York',
      payload: payload as never,
      scopedCollection,
      tenantField: 'tenant',
      tenantId: 'missing',
      timezoneField: 'timezone',
    })
    expect(tz).toBe('America/New_York')
  })

  it('falls back to the global zone when the scoped collection has no tenant relationship', async () => {
    const payload = { findByID: vi.fn() }
    const tz = await getEffectiveTenantTimezone({
      globalTimezone: 'America/New_York',
      payload: payload as never,
      scopedCollection: { fields: [{ name: 'title', type: 'text' }] },
      tenantField: 'tenant',
      tenantId: 't1',
      timezoneField: 'timezone',
    })
    expect(tz).toBe('America/New_York')
    expect(payload.findByID).not.toHaveBeenCalled()
  })
})

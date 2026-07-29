import { describe, expect, it, vi } from 'vitest'

import {
  callerMayUseTenant,
  getEffectiveTenantTimezone,
  normalizeRelationshipId,
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

describe('normalizeRelationshipId (pure)', () => {
  it('passes a string id through unchanged', () => {
    expect(normalizeRelationshipId('abc123')).toBe('abc123')
  })

  it('passes a number id through unchanged — the shape SQL adapters use', () => {
    expect(normalizeRelationshipId(2)).toBe(2)
  })

  it('extracts .id from a populated-relationship-shaped object', () => {
    expect(normalizeRelationshipId({ id: 'abc123' })).toBe('abc123')
    expect(normalizeRelationshipId({ id: 2 })).toBe(2)
  })

  it('extracts .id even alongside other populated fields', () => {
    expect(normalizeRelationshipId({ id: 'abc123', name: 'Tenant B' })).toBe('abc123')
  })

  it('returns null for an object with no usable id', () => {
    expect(normalizeRelationshipId({ id: null })).toBeNull()
    expect(normalizeRelationshipId({ id: { nested: true } })).toBeNull()
    expect(normalizeRelationshipId({ name: 'no id field' })).toBeNull()
  })

  it('returns null for shapes that are not id-like at all', () => {
    expect(normalizeRelationshipId(null)).toBeNull()
    expect(normalizeRelationshipId(undefined)).toBeNull()
    expect(normalizeRelationshipId(true)).toBeNull()
    expect(normalizeRelationshipId(['abc123'])).toBeNull()
  })
})

describe('callerMayUseTenant (DB-backed, id-shape and precondition coverage)', () => {
  const config = {
    multiTenant: { tenantField: 'tenant' },
    slugs: { reservations: 'reservations' },
  }
  const scopedReservations = {
    fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
  }
  const unscopedReservations = { fields: [{ name: 'title', type: 'text' }] }

  const makeReq = (overrides: {
    collections?: unknown[]
    findByID?: ReturnType<typeof vi.fn>
  }) => {
    const findByID = overrides.findByID ?? vi.fn().mockResolvedValue({ id: 'tenant-b' })
    const warn = vi.fn()
    return {
      findByID,
      req: {
        payload: {
          config: { collections: overrides.collections ?? [{ slug: 'reservations', ...scopedReservations }] },
          findByID,
          logger: { warn },
        },
      } as never,
      warn,
    }
  }

  it('returns true (nothing to check) when reservations is not tenant-scoped', async () => {
    const { findByID, req } = makeReq({
      collections: [{ slug: 'reservations', ...unscopedReservations }],
    })
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('returns true (nothing to check) when no explicit tenant value was supplied', async () => {
    const { findByID, req } = makeReq({})
    const permitted = await callerMayUseTenant({ config: config as never, data: {}, req })
    expect(permitted).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('probes with a string id and passes it through unchanged', async () => {
    const { findByID, req } = makeReq({})
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(true)
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tenant-b', collection: 'tenants', overrideAccess: false }),
    )
  })

  // The shape SQL adapters (Postgres, SQLite) use for a tenant id.
  it('probes with a number id and passes it through unchanged', async () => {
    const { findByID, req } = makeReq({})
    const permitted = await callerMayUseTenant({ config: config as never, data: { tenant: 2 }, req })
    expect(permitted).toBe(true)
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  // A populated relationship — `{ "tenant": { "id": "..." } }` — is a shape
  // Payload itself normalizes internally and a real client can send. The
  // probe must normalize it to the id BEFORE querying, not skip the check.
  it('probes with an object-shaped id, normalized to its .id', async () => {
    const { findByID, req } = makeReq({})
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: { id: 'tenant-b', name: 'Tenant B' } },
      req,
    })
    expect(permitted).toBe(true)
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ id: 'tenant-b' }))
  })

  it('fails closed for an unrecognized value shape, without probing', async () => {
    const { findByID, req } = makeReq({})
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: ['tenant-b'] },
      req,
    })
    expect(permitted).toBe(false)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('fails closed when the probe finds no matching tenant (not a member)', async () => {
    const { req } = makeReq({ findByID: vi.fn().mockResolvedValue(null) })
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(false)
  })

  it('fails closed WITHOUT logging when the probe throws Forbidden (403)', async () => {
    const { req, warn } = makeReq({
      findByID: vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 })),
    })
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails closed WITHOUT logging when the probe throws NotFound (404)', async () => {
    const { req, warn } = makeReq({
      findByID: vi.fn().mockRejectedValue(Object.assign(new Error('NotFound'), { status: 404 })),
    })
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails closed AND logs a warning for any other error (DB outage, genuine bug)', async () => {
    const { req, warn } = makeReq({
      findByID: vi.fn().mockRejectedValue(new Error('connection reset')),
    })
    const permitted = await callerMayUseTenant({
      config: config as never,
      data: { tenant: 'tenant-b' },
      req,
    })
    expect(permitted).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

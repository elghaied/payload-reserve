import type { Payload, PayloadRequest } from 'payload'

import { isValidTimezone } from './timezoneUtils.js'

type CollectionLike = { fields?: unknown[] } | null | undefined

type FieldLike = { name?: string; relationTo?: string | string[]; type?: string }

/**
 * Pure precedence resolver for a tenant's effective timezone:
 *
 *   selected tenant's zone  →  global default  →  'UTC'
 *
 * An absent or invalid zone at any step is skipped, never thrown — so a tenant
 * with a bad/empty timezone value transparently falls back to the global default.
 */
export function resolveTenantTimezone(args: {
  globalTimezone: string
  tenantTimezone?: null | string
}): string {
  const { globalTimezone, tenantTimezone } = args
  if (isValidTimezone(tenantTimezone)) {
    return tenantTimezone
  }
  if (isValidTimezone(globalTimezone)) {
    return globalTimezone
  }
  return 'UTC'
}

/**
 * The tenant collection's slug, read off the scoped collection's tenant
 * relationship field (`relationTo`). Keeps the plugin tenant-agnostic — it never
 * hardcodes a tenants slug. Returns null for an absent, polymorphic, or
 * non-relationship tenant field.
 */
export function tenantCollectionSlug(collection: CollectionLike, tenantField: string): null | string {
  const fields = collection?.fields
  if (!Array.isArray(fields)) {
    return null
  }
  for (const f of fields) {
    if (typeof f === 'object' && f !== null && (f as FieldLike).name === tenantField) {
      const rel = (f as FieldLike).relationTo
      return typeof rel === 'string' ? rel : null
    }
  }
  return null
}

/**
 * Resolve the effective timezone for the selected tenant in multiTenant mode.
 *
 * Loads the tenant document (slug derived from the scoped collection's tenant
 * relationship) and reads `timezoneField`, then applies {@link resolveTenantTimezone}
 * precedence. Returns the global default — without a DB read — when no tenant is
 * selected, when the scoped collection lacks a tenant relationship, or when the
 * lookup fails. Never throws.
 */
export async function getEffectiveTenantTimezone(args: {
  globalTimezone: string
  payload: Payload
  req?: PayloadRequest
  scopedCollection: CollectionLike
  tenantField: string
  tenantId: null | string
  timezoneField: string
}): Promise<string> {
  const { globalTimezone, payload, req, scopedCollection, tenantField, tenantId, timezoneField } =
    args
  if (!tenantId) {
    return resolveTenantTimezone({ globalTimezone })
  }
  const tenantSlug = tenantCollectionSlug(scopedCollection, tenantField)
  if (!tenantSlug) {
    return resolveTenantTimezone({ globalTimezone })
  }
  let tenantTimezone: null | string = null
  try {
    // The tenant id comes from a cookie, so the read must be access-checked —
    // multi-tenant constrains its tenants collection by `id`, which turns this
    // into a membership check. Without a req we cannot check, so stay privileged
    // and let the caller's own gate apply.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenant = await (payload.findByID as any)({
      id: tenantId,
      collection: tenantSlug,
      depth: 0,
      ...(req ? { overrideAccess: false, req } : {}),
    })
    const raw = (tenant as null | Record<string, unknown>)?.[timezoneField]
    tenantTimezone = typeof raw === 'string' ? raw : null
  } catch {
    tenantTimezone = null
  }
  return resolveTenantTimezone({ globalTimezone, tenantTimezone })
}

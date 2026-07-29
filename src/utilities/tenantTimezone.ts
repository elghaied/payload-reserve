import type { Payload, PayloadRequest } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { collectionHasTenantField } from './tenantFilter.js'
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

/**
 * Normalizes a relationship-shaped value down to its id: a raw string/number
 * id, or an object carrying one — `{ id }`, the shape both a populated
 * relationship and a client sending `{ "tenant": { "id": "..." } }` produce.
 * Returns null for anything else (including an object with no usable `id`),
 * so callers can fail closed on a shape they don't recognize instead of
 * silently skipping whatever check they were about to run.
 */
export function normalizeRelationshipId(value: unknown): null | number | string {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return id
    }
  }
  return null
}

/**
 * Every tenant id a tenant-field value names, as a list.
 *
 * Exists because multi-tenant supports a `hasMany` tenant field, so the value
 * can legitimately be an ARRAY of relationship-shaped entries.
 * {@link normalizeRelationshipId} returns null for an array, and the caller
 * fails closed on null — which turned a supported multi-tenant configuration
 * into a blanket 403 on every authenticated booking that carried an explicit
 * tenant (a total booking outage for that install, with no diagnostic).
 *
 * - `[]` -> `[]`: an empty array writes no tenant, so there is nothing to
 *   authorize; the caller permits it, exactly as it does for an absent value.
 * - a one-or-many array -> one id per entry, all of which the caller must be
 *   authorized for (any single unrecognized entry poisons the whole value).
 * - a scalar / `{ id }` -> a single-element list.
 * - anything else -> null, so the caller can still fail closed, loudly.
 */
export function normalizeRelationshipIds(value: unknown): Array<number | string> | null {
  if (Array.isArray(value)) {
    const ids: Array<number | string> = []
    for (const entry of value) {
      const id = normalizeRelationshipId(entry)
      if (id === null) {
        return null
      }
      ids.push(id)
    }
    return ids
  }
  const single = normalizeRelationshipId(value)
  return single === null ? null : [single]
}

/**
 * Whether an authenticated caller may write the tenant value present in
 * `data[config.multiTenant.tenantField]` onto a new document in
 * `config.slugs.reservations`.
 *
 * Exists because delegating `overrideAccess` is NOT sufficient on its own:
 * multi-tenant's tenant-field `validate` only checks presence, and Payload's
 * `create` operation (`executeAccess`) only checks the TRUTHINESS of a
 * collection access result — unlike read/update/delete, which apply a
 * returned `Where` via `combineQueries` against a real document. So MT's own
 * tenant-scoped `create` access can't reject an explicit foreign tenant
 * either; an authenticated caller can write one straight through regardless
 * of `overrideAccess`. This closes that gap the same way
 * {@link getEffectiveTenantTimezone} closes it for a client-supplied tenant
 * *cookie*: an access-checked (`overrideAccess: false`) probe read against
 * the tenants collection for the *submitted* tenant id — a lookup that finds
 * nothing means the caller isn't a member (or a multi-tenant super-admin).
 *
 * PRECONDITION — this is a real membership check only when the caller
 * authenticates against the SAME collection multi-tenant wraps as its
 * admin/tenant-owning collection. `withTenantAccess` only applies its
 * membership constraint when `req.user.collection === adminUsersSlug`;
 * otherwise it falls back to the tenants collection's own (here: default,
 * unrestricted) access function, which only requires `Boolean(req.user)`. In
 * this plugin's STANDALONE mode (`userCollection` unset), a customer
 * authenticates against `slugs.customers` — a collection multi-tenant never
 * wraps — so this probe passes for ANY tenant id for a logged-in customer.
 * `src/plugin.ts`'s boot diagnostic warns about that configuration. It is
 * also a no-op if the host set multi-tenant's own
 * `useTenantsCollectionAccess: false`, which is not detectable from here.
 *
 * Returns true — nothing to check — when the reservations collection isn't
 * tenant-scoped at all, or `data` doesn't carry an explicit tenant value (MT's
 * own access-checked `defaultValue` applies in that case; see
 * `getEffectiveTenantTimezone`'s doc comment for why that path is already
 * safe). Returns false — fail closed — for an unrecognized value shape (logged,
 * since a shape this plugin cannot read refuses every such booking), a probe
 * that finds no matching tenant, or any error while probing.
 *
 * A `hasMany` tenant field is supported: the value may be an array, and EVERY
 * id in it is probed.
 */
export async function callerMayUseTenant(args: {
  config: Pick<ResolvedReservationPluginConfig, 'multiTenant' | 'slugs'>
  data: Record<string, unknown>
  req: PayloadRequest
}): Promise<boolean> {
  const { config, data, req } = args
  const tenantField = config.multiTenant.tenantField
  const rawTenant = data[tenantField]
  if (rawTenant === undefined || rawTenant === null) {
    return true
  }

  const reservationsCollection = req.payload.config.collections?.find(
    (c) => c.slug === config.slugs.reservations,
  ) as CollectionLike
  if (!collectionHasTenantField(reservationsCollection, tenantField)) {
    return true
  }
  const tenantSlug = tenantCollectionSlug(reservationsCollection, tenantField)
  if (!tenantSlug) {
    return true
  }

  // A `hasMany` tenant field is a supported multi-tenant configuration, so the
  // value may be an array — every id in it must be authorized.
  const tenantIds = normalizeRelationshipIds(rawTenant)
  if (tenantIds === null) {
    // Still fail closed, but say so: an unrecognized shape refuses the booking,
    // and silently refusing every booking is indistinguishable from an outage.
    // The value itself is caller-supplied and is deliberately NOT logged.
    req.payload.logger.warn({
      msg: `payload-reserve: refusing a booking because its "${tenantField}" value has an unrecognized shape. Expected an id, a { id } object, or an array of either (a "hasMany" tenant field). If your tenant field uses a shape this plugin does not recognize, every authenticated booking carrying an explicit tenant will be refused with a 403.`,
      tenantValueShape: Array.isArray(rawTenant) ? 'array' : typeof rawTenant,
    })
    return false
  }

  for (const tenantId of tenantIds) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenant = await (req.payload.findByID as any)({
        id: tenantId,
        collection: tenantSlug,
        depth: 0,
        overrideAccess: false,
        req,
      })
      if (!tenant) {
        return false
      }
    } catch (err) {
      // Forbidden/NotFound is exactly the "not a member" outcome this probe
      // exists to detect — expected, not worth logging. Anything else (a DB
      // outage, a genuine bug) still fails closed but is worth surfacing.
      const status = (err as { status?: number } | undefined)?.status
      if (status !== 403 && status !== 404) {
        req.payload.logger.warn({ err, msg: 'payload-reserve: tenant membership probe failed' })
      }
      return false
    }
  }

  // Includes the empty-array case: no tenant is being written, so there is
  // nothing to authorize.
  return true
}

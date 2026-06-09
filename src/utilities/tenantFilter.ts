import type { Where } from 'payload'

type CollectionLike = { fields?: unknown[] } | null | undefined

type TenantGate = {
  hasField: boolean
  tenantField: string
  tenantId: null | string
}

/**
 * True if the collection has a top-level field named `fieldName`.
 *
 * Intentionally scans only top-level fields — does NOT descend into groups,
 * rows, or tabs. This is by design: the multi-tenant plugin injects its tenant
 * field at the top level of the collection, so a shallow scan is both correct
 * and sufficient.
 */
export function collectionHasTenantField(collection: CollectionLike, fieldName: string): boolean {
  if (!collection || !Array.isArray(collection.fields)) {
    return false
  }
  return collection.fields.some(
    (f) => typeof f === 'object' && f !== null && 'name' in f && (f as { name?: string }).name === fieldName,
  )
}

/** Parse a single cookie value from a Cookie header / document.cookie string. */
export function readCookie(cookieHeader: null | string | undefined, name: string): null | string {
  if (!cookieHeader) {
    return null
  }
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) {
      continue
    }
    if (part.slice(0, idx).trim() === name) {
      const raw = part.slice(idx + 1).trim()
      if (!raw) {
        return null
      }
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

/** REST query params: `{ 'where[<field>][equals]': id }`, or `{}` when not scoping. */
export function tenantQueryParams({ hasField, tenantField, tenantId }: TenantGate): Record<string, string> {
  if (!hasField || !tenantId) {
    return {}
  }
  return { [`where[${tenantField}][equals]`]: tenantId }
}

/** Local API `Where` clause, or `null` when not scoping. */
export function tenantWhereClause({ hasField, tenantField, tenantId }: TenantGate): null | Where {
  if (!hasField || !tenantId) {
    return null
  }
  return { [tenantField]: { equals: tenantId } }
}

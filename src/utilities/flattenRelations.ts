/**
 * Collapse populated relationships on a reservation to ids.
 *
 * `/reserve/book` and `/reserve/cancel` write with access overridden, and Payload
 * populates relationships under the same override — skipping field-level read
 * access — so the returned document carried the customer's staff-only `notes`
 * and, under `resourceOwnerMode`, the resource owner's whole user document.
 * The endpoints re-read at depth 0; this is the fallback when that read fails,
 * so a populated document never reaches the response either way.
 */
export function flattenRelations(doc: Record<string, unknown>): Record<string, unknown> {
  const toId = (v: unknown): unknown =>
    v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)
      ? (v as { id: unknown }).id
      : v
  const out: Record<string, unknown> = { ...doc }
  for (const key of ['customer', 'resource', 'service', 'tenant']) {
    if (key in out) {
      out[key] = toId(out[key])
    }
  }
  if (Array.isArray(out.items)) {
    out.items = (out.items as Array<Record<string, unknown>>).map((it) => ({
      ...it,
      resource: toId(it.resource),
      service: toId(it.service),
    }))
  }
  return out
}

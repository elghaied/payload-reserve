import { ValidationError } from 'payload'

export type ResolvedItem = {
  endTime: string
  /** True when this item was synthesised from the top-level resource/startTime. */
  fromParent?: boolean
  guestCount: number
  resource: number | string
  service?: number | string
  startTime: string
}

/**
 * Normalize reservation data into a list of resource-level items.
 *
 * - If items[] is populated -> return items (filling defaults from parent).
 *   Items missing startTime or resource throw a ValidationError.
 *   Duplicate (resource, startTime) pairs throw a ValidationError.
 * - If items[] is empty/absent -> return single item from top-level fields
 *
 * Every downstream function (conflict check, endTime calc, availability)
 * works with ResolvedItem[], never with raw reservation data.
 */
export function resolveReservationItems(data: Record<string, unknown>): ResolvedItem[] {
  const items = data.items as Array<Record<string, unknown>> | undefined

  if (items && items.length > 0) {
    const resolved: ResolvedItem[] = []
    const seen = new Set<string>()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const resource = extractId(item.resource) ?? extractId(data.resource)
      const startTime = (item.startTime as string) ?? (data.startTime as string)

      if (resource === undefined || resource === '') {
        throw new ValidationError({
          errors: [
            {
              message: `Item ${i} is missing a resource`,
              path: `items.${i}.resource`,
            },
          ],
        })
      }

      if (!startTime) {
        throw new ValidationError({
          errors: [
            {
              message: `Item ${i} is missing a startTime`,
              path: `items.${i}.startTime`,
            },
          ],
        })
      }

      const key = `${resource}::${startTime}`
      if (seen.has(key)) {
        throw new ValidationError({
          errors: [
            {
              message: `Duplicate booking: item ${i} has the same resource and startTime as a previous item`,
              path: `items.${i}.startTime`,
            },
          ],
        })
      }
      seen.add(key)

      resolved.push({
        endTime: (item.endTime as string) ?? (data.endTime as string),
        guestCount: (item.guestCount as number) ?? (data.guestCount as number) ?? 1,
        resource,
        service: extractId(item.service) ?? extractId(data.service),
        startTime,
      })
    }

    // The stored row occupies its top-level `resource` for every OTHER booking's
    // conflict check (buildCoarseOverlapQuery matches top level OR items[]), so
    // it must occupy it for its own check too. Skipped whenever an items[] entry
    // already targets the same resource — that entry's own window already
    // accounts for the occupancy. Dedup is by resource id, not an exact
    // (resource, startTime) match: calculateEndTime's multi-resource branch can
    // overwrite the top-level startTime/endTime to span every item, so by the
    // time this function runs a second time (e.g. from validateConflicts), the
    // top-level startTime is no longer reliably the parent resource's own
    // window — matching on id alone stays correct regardless.
    const parentResource = extractId(data.resource)
    const parentStart = data.startTime as string
    // String-compare ids: a raw id (string for Mongo, number for Postgres) and a
    // populated relationship's extracted `.id` should match even if one side
    // came through as a different primitive type than the other.
    const parentAlreadyItemized = resolved.some(
      (item) => String(item.resource) === String(parentResource),
    )
    if (
      parentResource !== undefined &&
      parentResource !== '' &&
      parentStart &&
      !parentAlreadyItemized
    ) {
      resolved.push({
        endTime: data.endTime as string,
        fromParent: true,
        guestCount: (data.guestCount as number) ?? 1,
        resource: parentResource,
        service: extractId(data.service),
        startTime: parentStart,
      })
    }

    return resolved
  }

  // Single-resource fallback (current behavior)
  if (!data.resource || !data.startTime) {
    return []
  }

  const resource = extractId(data.resource)
  if (resource === undefined || resource === '') {
    return []
  }

  return [
    {
      endTime: data.endTime as string,
      guestCount: (data.guestCount as number) ?? 1,
      resource,
      service: extractId(data.service),
      startTime: data.startTime as string,
    },
  ]
}

// Exported for unit testing. Returns the underlying id value from a relationship
// field which Payload represents as either the raw id (string for Mongo, number
// for Postgres) or a populated document `{ id, ... }`.
//
// Note: `0` is a valid numeric Postgres id but rare; we still return it rather
// than treat it as missing.
export function extractId(value: unknown): number | string | undefined {
  if (typeof value === 'string' && value) {
    return value
  }
  if (typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return undefined
}

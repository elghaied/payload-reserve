import { ValidationError } from 'payload'

import { doRangesOverlap } from './slotUtils.js'

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
 * - If items[] is populated -> return items (filling defaults from parent), then
 *   append a synthesised item for the top-level resource/startTime/endTime UNLESS
 *   an items[] entry can already be shown to cover that same window (see B1 in
 *   the synthesis step below) — this is what makes the top-level `resource`
 *   conflict-checked even when items[] never names it.
 *   Items missing startTime or resource throw a ValidationError.
 *   Duplicate (resource, startTime) pairs throw a ValidationError.
 *   An inverted top-level (parent) window throws a ValidationError too — UNLESS
 *   `options.lenient` is set, in which case parent synthesis is silently
 *   skipped instead (see the lenient-mode note below).
 * - If items[] is empty/absent -> return single item from top-level fields
 *
 * Every downstream function (conflict check, endTime calc, availability)
 * works with ResolvedItem[], never with raw reservation data.
 */
export function resolveReservationItems(
  data: Record<string, unknown>,
  options?: { lenient?: boolean },
): ResolvedItem[] {
  const lenient = options?.lenient ?? false
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
    // it must occupy it for its own check too. Sharing a resource id with an
    // items[] entry is NOT sufficient to skip synthesis — an items[] entry for
    // the same resource at an unrelated time is a genuinely separate occupancy,
    // and treating "same resource anywhere" as "already covered" reopens the
    // exact double-booking class this function exists to close (a caller can
    // list resource A at one time in items[] while the top-level fields book A
    // at a completely different, uncovered time). Synthesis is skipped only
    // when an items[] entry for the SAME resource can be shown to cover the
    // SAME window:
    //  (a) an exact startTime match — needs no endTime, so it still works when
    //      this function runs before endTime is computed (validateActive and
    //      calculateEndTime both call it before calculateEndTime has run); or
    //  (b) both endTimes are known and the windows overlap — covers
    //      calculateEndTime's multi-resource branch, which can overwrite the
    //      top-level startTime/endTime to SPAN every item, so by the time this
    //      function runs again (e.g. from validateConflicts) the parent's
    //      window no longer starts at the same instant as any one item even
    //      though that item's own window is fully contained in it.
    // When neither can be shown, synthesize: a redundant-but-harmless extra
    // check is far cheaper than a silently missed one.
    const parentResource = extractId(data.resource)
    const parentStart = data.startTime as string
    const parentEnd = data.endTime as string | undefined

    // An inverted parent window can never overlap anything, so the coverage test
    // below would always say "not covered" and synthesise a phantom item that
    // conflicts with nothing. Reject it at the source instead — it is malformed
    // input, not a case to paper over.
    //
    // Lenient mode (reservationOccupancies only — see AvailabilityService.ts)
    // resolves ALREADY-STORED documents, which can carry an inverted window
    // from a context.skipReservationHooks write or data predating this check.
    // A read must never crash over one malformed row, and — critically — it
    // must not lose the real items[] occupancies already resolved above by
    // throwing out of this function entirely. So lenient mode just skips
    // parent synthesis here instead of throwing: precisely the pre-check
    // behavior minus the (harmless but pointless) phantom item. The write
    // path never passes `lenient`, so it keeps the hard rejection.
    if (parentStart && parentEnd && new Date(parentEnd) <= new Date(parentStart)) {
      if (lenient) {
        return resolved
      }
      throw new ValidationError({
        errors: [{ message: 'endTime must be after startTime', path: 'endTime' }],
      })
    }

    if (parentResource !== undefined && parentResource !== '' && parentStart) {
      const parentAlreadyItemized = resolved.some((item) => {
        // String-compare ids: a raw id (string for Mongo, number for Postgres)
        // and a populated relationship's extracted `.id` should match even if
        // one side came through as a different primitive type than the other.
        if (String(item.resource) !== String(parentResource)) {
          return false
        }
        if (item.startTime === parentStart) {
          return true
        }
        return Boolean(
          parentEnd &&
            item.endTime &&
            doRangesOverlap(
              new Date(parentStart),
              new Date(parentEnd),
              new Date(item.startTime),
              new Date(item.endTime),
            ),
        )
      })

      if (!parentAlreadyItemized) {
        resolved.push({
          endTime: parentEnd as string,
          fromParent: true,
          guestCount: (data.guestCount as number) ?? 1,
          resource: parentResource,
          service: extractId(data.service),
          startTime: parentStart,
        })
      }
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

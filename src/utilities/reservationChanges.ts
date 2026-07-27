import { extractId } from './resolveReservationItems.js'

/**
 * Fields whose change means a reservation's slot occupancy may differ,
 * requiring conflict re-validation and endTime recomputation on update.
 */
const SCHEDULING_FIELDS = [
  'endTime',
  'guestCount',
  'items',
  'resource',
  'service',
  'startTime',
] as const

/**
 * Read-only merged view of an update: the original document overlaid with the
 * incoming partial patch. Used for validation only — never assign the result
 * back into `data`, or unchanged fields get written back to the database.
 */
export function mergeReservationData(
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(originalDoc ?? {}), ...(data ?? {}) }
}

function normalizeDate(value: unknown): null | number {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const time = new Date(value as string).getTime()
  return Number.isNaN(time) ? null : time
}

function normalizeRelationship(value: unknown): null | string {
  const id = extractId(value)
  return id === undefined ? null : String(id)
}

function itemsEqual(a: unknown, b: unknown): boolean {
  const listA = Array.isArray(a) ? (a as Array<Record<string, unknown>>) : []
  const listB = Array.isArray(b) ? (b as Array<Record<string, unknown>>) : []
  if (listA.length !== listB.length) {
    return false
  }
  return listA.every((itemA, i) => {
    const itemB = listB[i]
    return (
      normalizeRelationship(itemA.resource) === normalizeRelationship(itemB.resource) &&
      normalizeRelationship(itemA.service) === normalizeRelationship(itemB.service) &&
      normalizeDate(itemA.startTime) === normalizeDate(itemB.startTime) &&
      normalizeDate(itemA.endTime) === normalizeDate(itemB.endTime) &&
      ((itemA.guestCount ?? null) as null | number) ===
        ((itemB.guestCount ?? null) as null | number)
    )
  })
}

/**
 * True when the update patch changes any scheduling-relevant field, or moves
 * status from a non-blocking value into a blocking one (re-occupying a slot).
 * Key presence alone is not a change — full-document admin saves include every
 * field, and a notes-only edit must not trigger re-validation.
 */
export function schedulingFieldsChanged({
  blockingStatuses,
  data,
  originalDoc,
}: {
  /**
   * Omit to compare scheduling VALUES only, skipping the status clause below.
   * `validateActive` needs that: a confirm or cancel must stay possible on a
   * booking whose service or resource was deactivated after it was made.
   */
  blockingStatuses?: string[]
  data: Record<string, unknown>
  originalDoc: Record<string, unknown> | undefined
}): boolean {
  if (!originalDoc) {
    return true
  }

  for (const field of SCHEDULING_FIELDS) {
    if (!(field in data)) {
      continue
    }
    const next = data[field]
    const prev = originalDoc[field]
    let changed: boolean
    switch (field) {
      case 'endTime':
      case 'startTime':
        changed = normalizeDate(next) !== normalizeDate(prev)
        break
      case 'guestCount':
        changed = ((next ?? null) as null | number) !== ((prev ?? null) as null | number)
        break
      case 'items':
        changed = !itemsEqual(next, prev)
        break
      default:
        changed = normalizeRelationship(next) !== normalizeRelationship(prev)
    }
    if (changed) {
      return true
    }
  }

  if (blockingStatuses && 'status' in data && typeof data.status === 'string') {
    const prevStatus = originalDoc.status as string | undefined
    if (
      data.status !== prevStatus &&
      blockingStatuses.includes(data.status) &&
      (prevStatus === undefined || !blockingStatuses.includes(prevStatus))
    ) {
      return true
    }
  }

  return false
}

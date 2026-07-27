import type { Payload, PayloadRequest, Where } from 'payload'

import type { CapacityMode, DurationType, GetExternalBusy, StatusMachineConfig } from '../types.js'
import type { ResolvedItem } from '../utilities/resolveReservationItems.js'

import { NOOP_RESERVE_DEBUG, type ReserveDebug } from '../utilities/reserveDebug.js'
import { resolveReservationItems } from '../utilities/resolveReservationItems.js'
import { isExceptionDate, resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import {
  addMinutes,
  computeBlockedWindow,
  doRangesOverlap,
  intersectIntervals,
} from '../utilities/slotUtils.js'
import { endOfDayInTimezone } from '../utilities/timezoneUtils.js'

/** A window during which a resource is occupied. Reservation/sibling
 * occupancies are expanded by buffer times; external intervals (from
 * `getExternalBusy`) are used as-is — only the candidate window itself
 * carries buffers when checked against them. */
export type Occupancy = { blockedEnd: Date; blockedStart: Date; units: number }

/** Coarse pre-filter widen: covers any realistic neighbor buffer (buffers are
 * minutes). The precise per-item overlap check runs in memory afterwards. */
const COARSE_MARGIN_MS = 24 * 60 * 60 * 1000

// --- Pure functions (no DB) ---

export function computeEndTime(params: {
  durationType: DurationType
  endTime?: Date
  serviceDuration: number
  startTime: Date
  timeZone?: string
}): { durationMinutes: number; endTime: Date } {
  const { durationType, serviceDuration, startTime } = params

  if (durationType === 'full-day') {
    const end = endOfDayInTimezone(startTime, params.timeZone ?? 'UTC')
    const durationMinutes = Math.round((end.getTime() - startTime.getTime()) / 60_000)
    return { durationMinutes, endTime: end }
  }

  if (durationType === 'flexible' && params.endTime) {
    const durationMinutes = Math.round(
      (params.endTime.getTime() - startTime.getTime()) / 60_000,
    )
    return { durationMinutes, endTime: params.endTime }
  }

  // fixed duration (default)
  const endTime = addMinutes(startTime, serviceDuration)
  return { durationMinutes: serviceDuration, endTime }
}

export function buildOverlapQuery(params: {
  blockingStatuses: string[]
  effectiveEnd: Date
  effectiveStart: Date
  excludeReservationId?: number | string
  resourceId: number | string
}): Where {
  const { blockingStatuses, effectiveEnd, effectiveStart, excludeReservationId, resourceId } =
    params

  const conditions: Where[] = [
    { status: { in: blockingStatuses } },
    { startTime: { less_than: effectiveEnd.toISOString() } },
    { endTime: { greater_than: effectiveStart.toISOString() } },
    {
      or: [
        { resource: { equals: resourceId } },
        { 'items.resource': { equals: resourceId } },
      ],
    },
  ]

  if (excludeReservationId) {
    conditions.push({ id: { not_equals: excludeReservationId } })
  }

  return { and: conditions }
}

/**
 * Coarse superset query: blocking reservations whose top-level (span) window
 * comes within COARSE_MARGIN_MS of the candidate window and reference the
 * resource at top level or in items[]. The precise per-item overlap is computed
 * in memory afterwards — the top-level span is a superset of every item's
 * window, so this never misses a real conflict (margin covers neighbor buffers).
 */
export function buildCoarseOverlapQuery(params: {
  blockingStatuses: string[]
  candidateEnd: Date
  candidateStart: Date
  excludeReservationId?: number | string
  resourceId: number | string
}): Where {
  const { blockingStatuses, candidateEnd, candidateStart, excludeReservationId, resourceId } =
    params
  const windowStart = new Date(candidateStart.getTime() - COARSE_MARGIN_MS)
  const windowEnd = new Date(candidateEnd.getTime() + COARSE_MARGIN_MS)

  const conditions: Where[] = [
    { status: { in: blockingStatuses } },
    { startTime: { less_than: windowEnd.toISOString() } },
    { endTime: { greater_than: windowStart.toISOString() } },
    {
      or: [{ resource: { equals: resourceId } }, { 'items.resource': { equals: resourceId } }],
    },
  ]

  if (excludeReservationId !== undefined) {
    conditions.push({ id: { not_equals: excludeReservationId } })
  }

  return { and: conditions }
}

/**
 * The occupancy windows a set of resolved items imposes on `resourceId`. Each
 * matching item's [startTime, endTime) is expanded by that item's own service
 * buffers (so neighbor buffers are enforced — review A3), and only the items
 * that actually reference `resourceId` count (so a multi-resource booking blocks
 * each resource only for its own item's window — review A4).
 */
export async function itemsToOccupancies(params: {
  bufferFor: (serviceId: number | string | undefined) => Promise<{ after: number; before: number }>
  capacityMode: CapacityMode
  items: ResolvedItem[]
  resourceId: number | string
}): Promise<Occupancy[]> {
  const { bufferFor, capacityMode, items, resourceId } = params
  const occupancies: Occupancy[] = []

  for (const item of items) {
    if (String(item.resource) !== String(resourceId) || !item.endTime) {
      continue
    }
    const { after, before } = await bufferFor(item.service)
    const { effectiveEnd, effectiveStart } = computeBlockedWindow(
      new Date(item.startTime),
      new Date(item.endTime),
      before,
      after,
    )
    occupancies.push({
      blockedEnd: effectiveEnd,
      blockedStart: effectiveStart,
      units: capacityMode === 'per-guest' ? item.guestCount : 1,
    })
  }

  return occupancies
}

/** Occupancy a single fetched reservation imposes on `resourceId`. */
export async function reservationOccupancies(params: {
  bufferFor: (serviceId: number | string | undefined) => Promise<{ after: number; before: number }>
  capacityMode: CapacityMode
  reservation: Record<string, unknown>
  resourceId: number | string
}): Promise<Occupancy[]> {
  const { bufferFor, capacityMode, reservation, resourceId } = params
  return itemsToOccupancies({
    bufferFor,
    capacityMode,
    items: resolveReservationItems(reservation),
    resourceId,
  })
}

export function isBlockingStatus(
  status: string,
  statusMachine: StatusMachineConfig,
): boolean {
  return statusMachine.blockingStatuses.includes(status)
}

export function validateTransition(
  fromStatus: string,
  toStatus: string,
  statusMachine: StatusMachineConfig,
): { reason?: string; valid: boolean } {
  const allowed = statusMachine.transitions[fromStatus]
  if (!allowed) {
    return { reason: `Unknown status: ${fromStatus}`, valid: false }
  }
  if (!allowed.includes(toStatus)) {
    return {
      reason: `Cannot transition from "${fromStatus}" to "${toStatus}"`,
      valid: false,
    }
  }
  return { valid: true }
}

// --- DB functions (use Payload Local API only) ---

export async function checkAvailability(params: {
  blockingStatuses: string[]
  bufferAfter: number
  bufferBefore: number
  /** Optional tracer — emits check/check_result/error lines when enabled. */
  debug?: ReserveDebug
  endTime: Date
  excludeReservationId?: number | string
  /** External busy resolver (calendar sync etc.) — intervals block the whole resource. */
  getExternalBusy?: GetExternalBusy
  guestCount: number
  payload: Payload
  req: PayloadRequest
  reservationSlug: string
  resourceId: number | string
  resourceSlug: string
  servicesSlug: string
  /** Other items from the same booking — counted as occupancy (review A5). */
  siblingItems?: ResolvedItem[]
  startTime: Date
}): Promise<{
  available: boolean
  currentCount: number
  reason?: string
  totalCapacity: number
}> {
  const {
    blockingStatuses,
    bufferAfter,
    bufferBefore,
    debug,
    endTime,
    excludeReservationId,
    getExternalBusy,
    guestCount,
    payload,
    req,
    reservationSlug,
    resourceId,
    resourceSlug,
    servicesSlug,
    siblingItems,
    startTime,
  } = params

  const trace = debug ?? NOOP_RESERVE_DEBUG

  // Fetch resource for quantity and capacity mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resource = await (payload.findByID as any)({
    id: resourceId,
    collection: resourceSlug,
    depth: 0,
    req,
  })
  const quantity = (resource.quantity as number) ?? 1
  const capacityMode = ((resource.capacityMode as string) ?? 'per-reservation') as CapacityMode

  // Candidate window expanded by its own buffers
  const { effectiveEnd: candidateEnd, effectiveStart: candidateStart } = computeBlockedWindow(
    startTime,
    endTime,
    bufferBefore,
    bufferAfter,
  )

  // Coarse superset fetch — precise per-item overlap is computed in memory below
  const coarseWhere = buildCoarseOverlapQuery({
    blockingStatuses,
    candidateEnd,
    candidateStart,
    excludeReservationId,
    resourceId,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { docs } = await (payload.find as any)({
    collection: reservationSlug,
    depth: 0,
    limit: 0,
    req,
    where: coarseWhere,
  })

  trace.dbg('check', {
    blockingReservations: (docs as unknown[]).length,
    candidateEnd: candidateEnd.toISOString(),
    candidateStart: candidateStart.toISOString(),
    capacityMode,
    coarseWhere,
    quantity,
    resourceId,
  })

  // Per-call cache: fetch each distinct service's buffers at most once
  const bufferCache = new Map<string, { after: number; before: number }>()
  const bufferFor = async (
    serviceId: number | string | undefined,
  ): Promise<{ after: number; before: number }> => {
    const key = serviceId === undefined ? '' : String(serviceId)
    const cached = bufferCache.get(key)
    if (cached) {
      return cached
    }
    let result = { after: 0, before: 0 }
    if (serviceId !== undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (payload.findByID as any)({
          id: serviceId,
          collection: servicesSlug,
          depth: 0,
          // Skip the resources join — internal logic never reads it, and without this
          // every service read becomes an aggregation with a $lookup.
          joins: false,
          req,
        })
        if (service) {
          result = {
            after: (service.bufferTimeAfter as number) ?? 0,
            before: (service.bufferTimeBefore as number) ?? 0,
          }
        }
      } catch (err) {
        trace.dbg('error', { err, serviceId, where: 'bufferFor' })
      }
    }
    bufferCache.set(key, result)
    return result
  }

  const fetchedOccupancies = (
    await Promise.all(
      (docs as Array<Record<string, unknown>>).map((doc) =>
        reservationOccupancies({ bufferFor, capacityMode, reservation: doc, resourceId }),
      ),
    )
  ).flat()

  // Sibling items from the same booking (review A5) — expanded with the same
  // per-service buffers and capacity mode.
  const siblingOccupancies = siblingItems
    ? await itemsToOccupancies({ bufferFor, capacityMode, items: siblingItems, resourceId })
    : []

  // External busy (calendar sync etc.) — a synced calendar isn't unit-aware, so
  // an external event blocks the WHOLE resource (units = quantity), not one
  // unit. Fail-open: a resolver error must never block a real booking.
  let externalOccupancies: Occupancy[] = []
  if (getExternalBusy) {
    try {
      const intervals = await getExternalBusy({
        end: candidateEnd,
        req,
        resourceId,
        start: candidateStart,
      })
      externalOccupancies = intervals
        .map((iv) => ({
          blockedEnd: new Date(iv.end),
          blockedStart: new Date(iv.start),
          units: quantity,
        }))
        .filter((o) => !isNaN(o.blockedStart.getTime()) && !isNaN(o.blockedEnd.getTime()))
    } catch (err) {
      trace.dbg('error', { err, resourceId, where: 'getExternalBusy' })
      externalOccupancies = []
    }
  }

  const occupancies = [...fetchedOccupancies, ...siblingOccupancies, ...externalOccupancies]

  // Sum the units of every occupancy whose buffered window overlaps the candidate
  const currentUnits = occupancies.reduce(
    (sum, occ) =>
      doRangesOverlap(candidateStart, candidateEnd, occ.blockedStart, occ.blockedEnd)
        ? sum + occ.units
        : sum,
    0,
  )

  const candidateUnits = capacityMode === 'per-guest' ? guestCount : 1
  const available = currentUnits + candidateUnits <= quantity

  trace.dbg('check_result', {
    available,
    candidateUnits,
    currentUnits,
    occupancySources: {
      external: externalOccupancies.length,
      fetched: fetchedOccupancies.length,
      sibling: siblingOccupancies.length,
    },
    quantity,
    resourceId,
  })

  return {
    available,
    currentCount: currentUnits,
    reason: available
      ? undefined
      : capacityMode === 'per-guest'
        ? 'Guest capacity exceeded'
        : 'All units are booked for this time',
    totalCapacity: quantity,
  }
}

/**
 * Why availability came back empty. Returned alongside the slots so an empty
 * result is diagnosable without turning on `debug`.
 *
 * `no_active_schedules` and `date_excepted` are deliberately absent: they are
 * per-resource `skip` traces inside a loop, not return points — they funnel
 * into `no_windows` — and stay debug-only.
 *
 * `window_too_short` is reachable only from the general (non-full-day) branch:
 * the full-day branch returns `no_windows` before it, so it always has at least
 * one candidate.
 */
export type EmptyReason =
  | 'all_slots_taken'
  | 'empty_intersection'
  | 'no_resource_ids'
  | 'no_windows'
  | 'resource_inactive'
  | 'service_inactive'
  | 'window_too_short'

export async function getAvailableSlots(params: {
  blockingStatuses: string[]
  date: Date | string
  /** Optional tracer — emits per-stage slot-generation lines when enabled. */
  debug?: ReserveDebug
  /** Skip the service/resource `active` short-circuits when explicitly `false`. */
  enforceActive?: boolean
  /** External busy resolver (calendar sync etc.) — intervals block the whole resource. */
  getExternalBusy?: GetExternalBusy
  guestCount?: number
  payload: Payload
  req: PayloadRequest
  reservationSlug: string
  resourceId?: number | string
  resourceIds?: Array<number | string>
  resourceSlug: string
  scheduleSlug: string
  serviceId: number | string
  serviceSlug: string
  timeZone?: string
}): Promise<{ reason?: EmptyReason; slots: Array<{ end: Date; start: Date }> }> {
  const {
    blockingStatuses,
    date,
    debug,
    enforceActive,
    getExternalBusy,
    guestCount,
    payload,
    req,
    reservationSlug,
    resourceId,
    resourceIds,
    resourceSlug,
    scheduleSlug,
    serviceId,
    serviceSlug,
    timeZone,
  } = params

  const tz = timeZone ?? 'UTC'

  // Resolve the set of resources to intersect (single-resource callers still work)
  const ids =
    resourceIds && resourceIds.length > 0
      ? resourceIds
      : resourceId !== undefined
        ? [resourceId]
        : []

  const trace = (debug ?? NOOP_RESERVE_DEBUG).child({ resourceIds: ids, serviceId })
  trace.dbg('input', {
    date: date instanceof Date ? date.toISOString() : date,
    guestCount: guestCount ?? 1,
    timeZone: tz,
  })

  if (ids.length === 0) {
    trace.dbg('empty', { reason: 'no_resource_ids' })
    return { reason: 'no_resource_ids', slots: [] }
  }

  // 1. Service for duration + buffer times (from the primary service)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = await (payload.findByID as any)({
    id: serviceId,
    collection: serviceSlug,
    depth: 0,
    // Skip the resources join — internal logic never reads it, and without this
    // every service read becomes an aggregation with a $lookup.
    joins: false,
    req,
  })

  if (enforceActive !== false && service?.active === false) {
    trace.dbg('empty', { reason: 'service_inactive', serviceId })
    return { reason: 'service_inactive', slots: [] }
  }

  const duration = (service.duration as number) ?? 60
  const bufferBefore = (service.bufferTimeBefore as number) ?? 0
  const bufferAfter = (service.bufferTimeAfter as number) ?? 0
  const durationType = ((service.durationType as string) ?? 'fixed') as DurationType
  trace.dbg('service', { bufferAfter, bufferBefore, duration, durationType })

  // 2. Per resource: fetch schedules and resolve to windows. A resource with >=1
  //    schedule is "schedule-bearing" and constrains time; a resource with zero
  //    schedules is capacity-only and contributes no time windows.
  const scheduleBearingWindowLists: Array<Array<{ end: Date; start: Date }>> = []
  for (const rid of ids) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resourceDoc = await (payload.findByID as any)({
      id: rid,
      collection: resourceSlug,
      depth: 0,
      // Skip joins — internal logic never reads them, and without this every
      // resource read becomes an aggregation with a $lookup.
      joins: false,
      req,
    }).catch(() => null)
    if (enforceActive !== false && resourceDoc?.active === false) {
      trace.dbg('empty', { reason: 'resource_inactive', resourceId: rid })
      return { reason: 'resource_inactive', slots: [] }
    }

    const scheduleWhere = { and: [{ resource: { equals: rid } }, { active: { equals: true } }] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { docs: schedules } = await (payload.find as any)({
      collection: scheduleSlug,
      depth: 0,
      limit: 100,
      req,
      where: scheduleWhere,
    })
    trace.dbg('schedules', {
      activeFlags: (schedules as Array<Record<string, unknown>>).map((s) => s.active),
      resourceId: rid,
      rowsFound: (schedules as unknown[]).length,
      scheduleWhere,
    })
    if (!schedules || schedules.length === 0) {
      trace.dbg('skip', { reason: 'no_active_schedules', resourceId: rid, rowsFound: 0 })
      continue
    }
    // A11: an exception on ANY of the resource's schedules makes the whole
    // resource unavailable that day — not just the schedule it's recorded on.
    let matched: { exception: unknown; scheduleId: unknown } | undefined
    for (const s of schedules as Array<Record<string, unknown>>) {
      const exs = (s.exceptions as Array<{ date: string; endDate?: string }> | undefined) ?? []
      if (isExceptionDate(date, exs, tz)) {
        matched = { exception: exs.find((e) => isExceptionDate(date, [e], tz)), scheduleId: s.id }
        break
      }
    }
    if (matched) {
      trace.dbg('skip', {
        matchedException: matched.exception,
        reason: 'date_excepted',
        resourceId: rid,
        scheduleId: matched.scheduleId,
      })
      scheduleBearingWindowLists.push([])
      continue
    }
    const windows: Array<{ end: Date; start: Date }> = []
    for (const schedule of schedules) {
      windows.push(
        ...resolveScheduleForDate(
          schedule as unknown as Parameters<typeof resolveScheduleForDate>[0],
          date,
          tz,
        ),
      )
    }
    trace.dbg('windows', {
      resourceId: rid,
      windowCount: windows.length,
      windows: windows.map((w) => ({ end: w.end.toISOString(), start: w.start.toISOString() })),
      windowsEmpty: windows.length === 0,
    })
    scheduleBearingWindowLists.push(windows)
  }

  // No resource constrains time → no basis for generating slots
  if (scheduleBearingWindowLists.length === 0) {
    trace.dbg('empty', { reason: 'no_windows' })
    return { reason: 'no_windows', slots: [] }
  }

  // 3. Intersect all schedule-bearing window lists
  let timeRanges = scheduleBearingWindowLists[0]
  for (let i = 1; i < scheduleBearingWindowLists.length; i++) {
    timeRanges = intersectIntervals(timeRanges, scheduleBearingWindowLists[i])
  }
  if (timeRanges.length === 0) {
    trace.dbg('empty', {
      perResourceWindows: scheduleBearingWindowLists.map((list) =>
        list.map((w) => ({ end: w.end.toISOString(), start: w.start.toISOString() })),
      ),
      reason: 'empty_intersection',
    })
    return { reason: 'empty_intersection', slots: [] }
  }

  // 4. Candidate slot sizing
  // NOTE: epoch-trick sizing is only meaningful for fixed/flexible durations.
  // full-day services return early via the range-as-slot branch below and never
  // consume slotDuration — keep it that way if reordering this function.
  const { endTime: slotEndOffset } = computeEndTime({
    durationType,
    serviceDuration: duration,
    startTime: new Date(0),
    timeZone: tz,
  })
  const slotDuration = Math.round(slotEndOffset.getTime() / 60_000)
  const effectiveDuration = durationType === 'fixed' ? duration : slotDuration
  trace.dbg('sizing', {
    effectiveDuration,
    slotDuration,
    stepSize: Math.min(effectiveDuration, 15),
  })

  // Helper: a window is available only if EVERY required resource is free
  const allAvailable = async (
    start: Date,
    end: Date,
    bBefore: number,
    bAfter: number,
  ): Promise<boolean> => {
    for (const rid of ids) {
      const result = await checkAvailability({
        blockingStatuses,
        bufferAfter: bAfter,
        bufferBefore: bBefore,
        debug: trace,
        endTime: end,
        getExternalBusy,
        guestCount: guestCount ?? 1,
        payload,
        req,
        reservationSlug,
        resourceId: rid,
        resourceSlug,
        servicesSlug: serviceSlug,
        startTime: start,
      })
      if (!result.available) {
        return false
      }
    }
    return true
  }

  const availableSlots: Array<{ end: Date; start: Date }> = []

  // Full-day: offer each range as a single slot if all resources are free
  if (durationType === 'full-day') {
    let candidatesGenerated = 0
    for (const range of timeRanges) {
      candidatesGenerated++
      if (await allAvailable(range.start, range.end, 0, 0)) {
        availableSlots.push({ end: range.end, start: range.start })
      }
    }
    trace.dbg('result', {
      candidatesAvailable: availableSlots.length,
      candidatesGenerated,
      durationType: 'full-day',
      returnedCount: availableSlots.length,
    })
    return {
      ...(availableSlots.length === 0 ? { reason: 'all_slots_taken' as const } : {}),
      slots: availableSlots,
    }
  }

  const stepSize = Math.min(effectiveDuration, 15)
  let candidatesGenerated = 0

  for (const range of timeRanges) {
    let candidateStart = new Date(range.start)

    while (true) {
      const candidateEnd = addMinutes(candidateStart, effectiveDuration)
      if (candidateEnd > range.end) {
        break
      }

      candidatesGenerated++
      if (await allAvailable(candidateStart, candidateEnd, bufferBefore, bufferAfter)) {
        availableSlots.push({ end: candidateEnd, start: new Date(candidateStart) })
      }

      candidateStart = addMinutes(candidateStart, stepSize)
    }
  }

  trace.dbg('result', {
    candidatesAvailable: availableSlots.length,
    candidatesGenerated,
    returnedCount: availableSlots.length,
  })
  return {
    ...(availableSlots.length === 0
      ? {
          reason: (candidatesGenerated === 0
            ? 'window_too_short'
            : 'all_slots_taken') as EmptyReason,
        }
      : {}),
    slots: availableSlots,
  }
}

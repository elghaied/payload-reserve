import type { Payload, PayloadRequest, Where } from 'payload'

import type { CapacityMode, DurationType, StatusMachineConfig } from '../types.js'

import { resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import { addMinutes, computeBlockedWindow, intersectIntervals } from '../utilities/slotUtils.js'
import { endOfDayInTimezone } from '../utilities/timezoneUtils.js'

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
  endTime: Date
  excludeReservationId?: number | string
  guestCount: number
  payload: Payload
  req: PayloadRequest
  reservationSlug: string
  resourceId: number | string
  resourceSlug: string
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
    endTime,
    excludeReservationId,
    guestCount,
    payload,
    req,
    reservationSlug,
    resourceId,
    resourceSlug,
    startTime,
  } = params

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

  // Compute effective window with buffers
  const { effectiveEnd, effectiveStart } = computeBlockedWindow(
    startTime,
    endTime,
    bufferBefore,
    bufferAfter,
  )

  // Build overlap query
  const where = buildOverlapQuery({
    blockingStatuses,
    effectiveEnd,
    effectiveStart,
    excludeReservationId,
    resourceId,
  })

  if (capacityMode === 'per-guest') {
    // Must fetch docs to sum guestCount
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { docs } = await (payload.find as any)({
      collection: reservationSlug,
      depth: 0,
      limit: 0,
      req,
      select: { guestCount: true },
      where,
    })
    const currentGuests = docs.reduce(
      (sum: number, doc: Record<string, unknown>) => sum + ((doc.guestCount as number) ?? 1),
      0,
    )
    return {
      available: currentGuests + guestCount <= quantity,
      currentCount: currentGuests,
      reason:
        currentGuests + guestCount > quantity ? 'Guest capacity exceeded' : undefined,
      totalCapacity: quantity,
    }
  }

  // per-reservation mode: count is sufficient
  // TODO: batch queries — linear per-item cost acceptable for 2-5 items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { totalDocs } = await (payload.count as any)({
    collection: reservationSlug,
    req,
    where,
  })
  return {
    available: totalDocs + 1 <= quantity,
    currentCount: totalDocs,
    reason: totalDocs + 1 > quantity ? 'All units are booked for this time' : undefined,
    totalCapacity: quantity,
  }
}

export async function getAvailableSlots(params: {
  blockingStatuses: string[]
  date: Date | string
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
}): Promise<Array<{ end: Date; start: Date }>> {
  const {
    blockingStatuses,
    date,
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
  if (ids.length === 0) {
    return []
  }

  // 1. Service for duration + buffer times (from the primary service)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = await (payload.findByID as any)({
    id: serviceId,
    collection: serviceSlug,
    depth: 0,
    req,
  })
  const duration = (service.duration as number) ?? 60
  const bufferBefore = (service.bufferTimeBefore as number) ?? 0
  const bufferAfter = (service.bufferTimeAfter as number) ?? 0
  const durationType = ((service.durationType as string) ?? 'fixed') as DurationType

  // 2. Per resource: fetch schedules and resolve to windows. A resource with >=1
  //    schedule is "schedule-bearing" and constrains time; a resource with zero
  //    schedules is capacity-only and contributes no time windows.
  const scheduleBearingWindowLists: Array<Array<{ end: Date; start: Date }>> = []
  for (const rid of ids) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { docs: schedules } = await (payload.find as any)({
      collection: scheduleSlug,
      depth: 0,
      limit: 100,
      req,
      where: {
        and: [{ resource: { equals: rid } }, { active: { equals: true } }],
      },
    })
    if (!schedules || schedules.length === 0) {
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
    scheduleBearingWindowLists.push(windows)
  }

  // No resource constrains time → no basis for generating slots
  if (scheduleBearingWindowLists.length === 0) {
    return []
  }

  // 3. Intersect all schedule-bearing window lists
  let timeRanges = scheduleBearingWindowLists[0]
  for (let i = 1; i < scheduleBearingWindowLists.length; i++) {
    timeRanges = intersectIntervals(timeRanges, scheduleBearingWindowLists[i])
  }
  if (timeRanges.length === 0) {
    return []
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
        endTime: end,
        guestCount: guestCount ?? 1,
        payload,
        req,
        reservationSlug,
        resourceId: rid,
        resourceSlug,
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
    for (const range of timeRanges) {
      if (await allAvailable(range.start, range.end, 0, 0)) {
        availableSlots.push({ end: range.end, start: range.start })
      }
    }
    return availableSlots
  }

  const stepSize = Math.min(effectiveDuration, 15)

  for (const range of timeRanges) {
    let candidateStart = new Date(range.start)

    while (true) {
      const candidateEnd = addMinutes(candidateStart, effectiveDuration)
      if (candidateEnd > range.end) {
        break
      }

      if (await allAvailable(candidateStart, candidateEnd, bufferBefore, bufferAfter)) {
        availableSlots.push({ end: candidateEnd, start: new Date(candidateStart) })
      }

      candidateStart = addMinutes(candidateStart, stepSize)
    }
  }

  return availableSlots
}

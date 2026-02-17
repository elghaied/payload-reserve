import type { Payload, PayloadRequest, Where } from 'payload'

import type { CapacityMode, DurationType, StatusMachineConfig } from '../types.js'

import { resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import { addMinutes, computeBlockedWindow } from '../utilities/slotUtils.js'

// --- Pure functions (no DB) ---

export function computeEndTime(params: {
  durationType: DurationType
  endTime?: Date
  serviceDuration: number
  startTime: Date
}): { durationMinutes: number; endTime: Date } {
  const { durationType, serviceDuration, startTime } = params

  if (durationType === 'full-day') {
    const end = new Date(startTime)
    end.setHours(23, 59, 59, 999)
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
  excludeReservationId?: string
  resourceId: string
}): Where {
  const { blockingStatuses, effectiveEnd, effectiveStart, excludeReservationId, resourceId } =
    params

  const conditions: Where[] = [
    { resource: { equals: resourceId } },
    { status: { in: blockingStatuses } },
    { startTime: { less_than: effectiveEnd.toISOString() } },
    { endTime: { greater_than: effectiveStart.toISOString() } },
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
  excludeReservationId?: string
  guestCount: number
  payload: Payload
  req: PayloadRequest
  reservationSlug: string
  resourceId: string
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
  const resource = await payload.findByID({
    id: resourceId,
    collection: resourceSlug as 'resources',
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
    const { docs } = await payload.find({
      collection: reservationSlug as 'reservations',
      depth: 0,
      limit: 0,
      req,
      select: { guestCount: true },
      where,
    })
    const currentGuests = docs.reduce(
      (sum, doc) => sum + ((doc.guestCount as number) ?? 1),
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
  const { totalDocs } = await payload.count({
    collection: reservationSlug as 'reservations',
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
  date: Date
  payload: Payload
  req: PayloadRequest
  reservationSlug: string
  resourceId: string
  resourceSlug: string
  scheduleSlug: string
  serviceId: string
  serviceSlug: string
}): Promise<Array<{ end: Date; start: Date }>> {
  const {
    blockingStatuses,
    date,
    payload,
    req,
    reservationSlug,
    resourceId,
    resourceSlug,
    scheduleSlug,
    serviceId,
    serviceSlug,
  } = params

  // 1. Fetch service for duration + buffer times
  const service = await payload.findByID({
    id: serviceId,
    collection: serviceSlug as 'services',
    depth: 0,
    req,
  })
  const duration = (service.duration as number) ?? 60
  const bufferBefore = (service.bufferTimeBefore as number) ?? 0
  const bufferAfter = (service.bufferTimeAfter as number) ?? 0
  const durationType = ((service.durationType as string) ?? 'fixed') as DurationType

  // 2. Fetch resource's schedules for the date
  const { docs: schedules } = await payload.find({
    collection: scheduleSlug as 'schedules',
    depth: 0,
    limit: 100,
    req,
    where: {
      and: [{ resource: { equals: resourceId } }, { active: { equals: true } }],
    },
  })

  // 3. Resolve schedules to time ranges for the date
  const timeRanges: Array<{ end: Date; start: Date }> = []
  for (const schedule of schedules) {
    const ranges = resolveScheduleForDate(
      schedule as unknown as Parameters<typeof resolveScheduleForDate>[0],
      date,
    )
    timeRanges.push(...ranges)
  }

  if (timeRanges.length === 0) {
    return []
  }

  // 4. Generate candidate slots from schedule ranges
  const { endTime: slotEndOffset } = computeEndTime({
    durationType,
    serviceDuration: duration,
    startTime: new Date(0),
  })
  const slotDuration = Math.round(slotEndOffset.getTime() / 60_000)
  const effectiveDuration = durationType === 'fixed' ? duration : slotDuration

  const availableSlots: Array<{ end: Date; start: Date }> = []

  for (const range of timeRanges) {
    let candidateStart = new Date(range.start)

    while (true) {
      const candidateEnd = addMinutes(candidateStart, effectiveDuration)
      if (candidateEnd > range.end) {break}

      // 5. Check availability for each candidate slot
      const result = await checkAvailability({
        blockingStatuses,
        bufferAfter,
        bufferBefore,
        endTime: candidateEnd,
        guestCount: 1,
        payload,
        req,
        reservationSlug,
        resourceId,
        resourceSlug,
        startTime: candidateStart,
      })

      if (result.available) {
        availableSlots.push({ end: candidateEnd, start: new Date(candidateStart) })
      }

      // Move to next slot (service duration as step)
      candidateStart = addMinutes(candidateStart, effectiveDuration)
    }
  }

  return availableSlots
}

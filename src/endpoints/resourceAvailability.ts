import type { Endpoint, Payload, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import { localDayKey } from '../utilities/slotUtils.js'

type DayAvailability = {
  date: string
  shiftWindows: Array<{ end: string; start: string }>
  timeOff: Array<{ end: string; reason?: string; start: string; type?: string }>
}

export type ResourceAvailability = {
  busy: Array<{ end: string; start: string; units: number }>
  capacityMode: 'per-guest' | 'per-reservation'
  days: DayAvailability[]
  quantity: number
}

export async function buildResourceAvailability(params: {
  blockingStatuses: string[]
  end: Date
  payload: Payload
  reservationSlug: string
  resourceId: number | string
  resourceSlug: string
  scheduleSlug: string
  start: Date
}): Promise<ResourceAvailability> {
  const {
    blockingStatuses,
    end,
    payload,
    reservationSlug,
    resourceId,
    resourceSlug,
    scheduleSlug,
    start,
  } = params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resource = await (payload.findByID as any)({
    id: resourceId,
    collection: resourceSlug,
    depth: 0,
  })
  const quantity = (resource?.quantity as number) ?? 1
  const capacityMode = (resource?.capacityMode as 'per-guest' | 'per-reservation') ?? 'per-reservation'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { docs: schedules } = await (payload.find as any)({
    collection: scheduleSlug,
    depth: 0,
    limit: 100,
    where: { and: [{ active: { equals: true } }, { resource: { equals: resourceId } }] },
  })

  type RawException = {
    date: string
    endDate?: string
    reason?: string
    type?: string
  }

  const days: DayAvailability[] = []
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    const date = localDayKey(d)
    const shiftWindows: DayAvailability['shiftWindows'] = []
    const timeOff: DayAvailability['timeOff'] = []
    const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())

    for (const sched of schedules as Array<Record<string, unknown>>) {
      // resolveScheduleForDate accepts a Schedule-shaped object; cast through unknown
      const ranges = resolveScheduleForDate(
        sched as unknown as Parameters<typeof resolveScheduleForDate>[0],
        localMidnight,
      )
      for (const r of ranges) {
        shiftWindows.push({ end: r.end.toISOString(), start: r.start.toISOString() })
      }

      const exceptions = (sched.exceptions as RawException[] | undefined) ?? []
      for (const exc of exceptions) {
        const excStart = localDayKey(new Date(exc.date))
        const excEnd = exc.endDate ? localDayKey(new Date(exc.endDate)) : excStart
        if (date >= excStart && date <= excEnd) {
          const localStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
          const localEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
          timeOff.push({
            type: exc.type,
            end: localEnd.toISOString(),
            reason: exc.reason,
            start: localStart.toISOString(),
          })
        }
      }
    }

    days.push({ date, shiftWindows, timeOff })
  }

  const where: Where = {
    and: [
      { status: { in: blockingStatuses } },
      { startTime: { less_than: end.toISOString() } },
      { endTime: { greater_than: start.toISOString() } },
      {
        or: [
          { resource: { equals: resourceId } },
          { 'items.resource': { equals: resourceId } },
        ],
      },
    ],
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { docs: reservations } = await (payload.find as any)({
    collection: reservationSlug,
    depth: 0,
    limit: 500,
    where,
  })

  const busy = (reservations as Array<Record<string, unknown>>)
    .filter((r) => r.startTime && r.endTime)
    .map((r) => ({
      end: new Date(r.endTime as string).toISOString(),
      start: new Date(r.startTime as string).toISOString(),
      units: capacityMode === 'per-guest' ? ((r.guestCount as number) ?? 1) : 1,
    }))

  return { busy, capacityMode, days, quantity }
}

export function createResourceAvailabilityEndpoint(
  config: ResolvedReservationPluginConfig,
): Endpoint {
  return {
    handler: async (req) => {
      const url = new URL(req.url!)
      const resource = url.searchParams.get('resource')
      const start = url.searchParams.get('start')
      const end = url.searchParams.get('end')

      if (!resource || !start || !end) {
        return Response.json(
          { error: 'Missing required query params: resource, start, end' },
          { status: 400 },
        )
      }

      const startDate = new Date(start)
      const endDate = new Date(end)
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return Response.json({ error: 'Invalid start/end date' }, { status: 400 })
      }

      const result = await buildResourceAvailability({
        blockingStatuses: config.statusMachine.blockingStatuses,
        end: endDate,
        payload: req.payload,
        reservationSlug: config.slugs.reservations,
        resourceId: resource,
        resourceSlug: config.slugs.resources,
        scheduleSlug: config.slugs.schedules,
        start: startDate,
      })

      return Response.json(result)
    },
    method: 'get',
    path: '/reserve/resource-availability',
  }
}

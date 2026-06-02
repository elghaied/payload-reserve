import type { Endpoint, Payload, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import { localDayKey } from '../utilities/slotUtils.js'

type DayAvailability = {
  date: string
  shiftWindows: Array<{ end: string; start: string }>
  timeOff: Array<{ end: string; reason?: string; start: string; type?: string }>
}

type Busy = Array<{ end: string; start: string; units: number }>

export type ResourceAvailability = {
  busy: Busy
  capacityMode: 'per-guest' | 'per-reservation'
  days: DayAvailability[]
  quantity: number
  /** Capacity of resources this resource's services also require (e.g. a chair pool). */
  requiredPools: Array<{ busy: Busy; quantity: number }>
}

/** Busy intervals (with capacity units) for one resource over [start, end). */
async function busyFor(args: {
  blockingStatuses: string[]
  capacityMode: 'per-guest' | 'per-reservation'
  end: Date
  payload: Payload
  reservationSlug: string
  resourceId: number | string
  start: Date
}): Promise<Busy> {
  const { blockingStatuses, capacityMode, end, payload, reservationSlug, resourceId, start } = args
  const where: Where = {
    and: [
      { status: { in: blockingStatuses } },
      { startTime: { less_than: end.toISOString() } },
      { endTime: { greater_than: start.toISOString() } },
      { or: [{ resource: { equals: resourceId } }, { 'items.resource': { equals: resourceId } }] },
    ],
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { docs } = await (payload.find as any)({ collection: reservationSlug, depth: 0, limit: 500, where })
  return (docs as Array<Record<string, unknown>>)
    .filter((r) => r.startTime && r.endTime)
    .map((r) => ({
      end: new Date(r.endTime as string).toISOString(),
      start: new Date(r.startTime as string).toISOString(),
      units: capacityMode === 'per-guest' ? ((r.guestCount as number) ?? 1) : 1,
    }))
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

  // depth 1 so `services` are populated (their `requiredResources` come back as ids)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resource = await (payload.findByID as any)({
    id: resourceId,
    collection: resourceSlug,
    depth: 1,
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

  const busy = await busyFor({
    blockingStatuses,
    capacityMode,
    end,
    payload,
    reservationSlug,
    resourceId,
    start,
  })

  // Resources this resource's services ALSO require (e.g. a shared chair pool).
  // A slot isn't truly bookable if any of these is at capacity, even when the
  // resource itself is free — so the calendar reflects real availability.
  const poolIds = new Set<string>()
  for (const svc of (resource?.services as Array<Record<string, unknown>>) ?? []) {
    const reqs = (typeof svc === 'object' ? (svc.requiredResources as unknown[]) : []) ?? []
    for (const rr of reqs) {
      const id: number | string | undefined =
        typeof rr === 'object' && rr !== null
          ? (rr as { id?: number | string }).id
          : (rr as number | string)
      if (id != null && String(id) !== String(resourceId)) {
        poolIds.add(String(id))
      }
    }
  }

  const requiredPools: ResourceAvailability['requiredPools'] = []
  for (const poolId of poolIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pool = await (payload.findByID as any)({ id: poolId, collection: resourceSlug, depth: 0 }).catch(
      () => null,
    )
    if (!pool) {
      continue
    }
    const poolCapacityMode =
      (pool.capacityMode as 'per-guest' | 'per-reservation') ?? 'per-reservation'
    requiredPools.push({
      busy: await busyFor({
        blockingStatuses,
        capacityMode: poolCapacityMode,
        end,
        payload,
        reservationSlug,
        resourceId: poolId,
        start,
      }),
      quantity: (pool.quantity as number) ?? 1,
    })
  }

  return { busy, capacityMode, days, quantity, requiredPools }
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

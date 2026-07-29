import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'

import type {
  ExternalBusyInterval,
  GetExternalBusy,
  ResolvedReservationPluginConfig,
} from '../types.js'

import {
  createReserveDebug,
  NOOP_RESERVE_DEBUG,
  type ReserveDebug,
} from '../utilities/reserveDebug.js'
import { resolveScheduleForDate } from '../utilities/scheduleUtils.js'
import { readCookie } from '../utilities/tenantFilter.js'
import { getEffectiveTenantTimezone } from '../utilities/tenantTimezone.js'
import {
  addDaysToDayKey,
  combineDayKeyAndTime,
  getDayKeyInTimezone,
} from '../utilities/timezoneUtils.js'
import { isPrivilegedUser } from '../utilities/userRoles.js'

const MAX_RANGE_MS = 90 * 86_400_000

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
  /** External busy intervals (calendar sync etc.) from getExternalBusy — display-only here; enforcement lives in checkAvailability. */
  external: ExternalBusyInterval[]
  quantity: number
  /** Capacity of resources this resource's services also require (e.g. a chair pool). */
  requiredPools: Array<{ busy: Busy; quantity: number }>
  /** IANA zone the day windows were resolved in (selected tenant's zone, else global). */
  timeZone: string
}

/** Busy intervals (with capacity units) for one resource over [start, end). */
async function busyFor(args: {
  blockingStatuses: string[]
  capacityMode: 'per-guest' | 'per-reservation'
  end: Date
  /** Slot-holds slug; omit to ignore holds (i.e. when `slotHolds` is off). */
  holdsSlug?: string
  payload: Payload
  reservationSlug: string
  resourceId: number | string
  start: Date
}): Promise<Busy> {
  const {
    blockingStatuses,
    capacityMode,
    end,
    holdsSlug,
    payload,
    reservationSlug,
    resourceId,
    start,
  } = args
  const where: Where = {
    and: [
      { status: { in: blockingStatuses } },
      { startTime: { less_than: end.toISOString() } },
      { endTime: { greater_than: start.toISOString() } },
      { or: [{ resource: { equals: resourceId } }, { 'items.resource': { equals: resourceId } }] },
    ],
  }
  // limit:0 = all matching — bounded by the endpoint's 90-day range cap, so this
  // can't run away, and the grid no longer silently drops busy intervals (D9).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { docs } = await (payload.find as any)({
    collection: reservationSlug,
    depth: 0,
    limit: 0,
    where,
  })
  const busy: Busy = (docs as Array<Record<string, unknown>>)
    .filter((r) => r.startTime && r.endTime)
    .map((r) => ({
      end: new Date(r.endTime as string).toISOString(),
      start: new Date(r.startTime as string).toISOString(),
      units: capacityMode === 'per-guest' ? ((r.guestCount as number) ?? 1) : 1,
    }))

  // An unexpired hold occupies the resource exactly as a blocking reservation
  // does — the write path counts it — so the grid must show it busy. Expiry is a
  // read-time predicate here for the same reason it is in `checkAvailability`:
  // TTL indexes are MongoDB-only.
  if (holdsSlug) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { docs: holdDocs } = await (payload.find as any)({
      collection: holdsSlug,
      depth: 0,
      limit: 0,
      where: {
        and: [
          { resource: { equals: resourceId } },
          { expiresAt: { greater_than: new Date().toISOString() } },
          { startTime: { less_than: end.toISOString() } },
          { endTime: { greater_than: start.toISOString() } },
        ],
      } as Where,
    })
    for (const hold of holdDocs as Array<Record<string, unknown>>) {
      if (!hold.startTime || !hold.endTime) {
        continue
      }
      busy.push({
        end: new Date(hold.endTime as string).toISOString(),
        start: new Date(hold.startTime as string).toISOString(),
        units: capacityMode === 'per-guest' ? ((hold.guestCount as number) ?? 1) : 1,
      })
    }
  }

  return busy
}

export async function buildResourceAvailability(params: {
  blockingStatuses: string[]
  debug?: ReserveDebug
  end: Date
  getExternalBusy?: GetExternalBusy
  /** Slot-holds slug; omit to ignore holds (i.e. when `slotHolds` is off). */
  holdsSlug?: string
  payload: Payload
  req?: PayloadRequest
  reservationSlug: string
  resourceId: number | string
  resourceSlug: string
  scheduleSlug: string
  start: Date
  timeZone: string
}): Promise<null | ResourceAvailability> {
  const {
    blockingStatuses,
    debug,
    end,
    getExternalBusy,
    holdsSlug,
    payload,
    req,
    reservationSlug,
    resourceId,
    resourceSlug,
    scheduleSlug,
    start,
    timeZone,
  } = params
  const trace = debug ?? NOOP_RESERVE_DEBUG

  // depth 1 so `services` are populated (their `requiredResources` come back as ids)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resource = await (payload.findByID as any)({
    id: resourceId,
    collection: resourceSlug,
    depth: 1,
  }).catch(() => null)
  if (!resource) {
    return null
  }
  const quantity = (resource?.quantity as number) ?? 1
  const capacityMode =
    (resource?.capacityMode as 'per-guest' | 'per-reservation') ?? 'per-reservation'

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
  const startKey = getDayKeyInTimezone(start, timeZone)
  const lastKey = getDayKeyInTimezone(new Date(end.getTime() - 1), timeZone)
  for (let date = startKey; date <= lastKey; date = addDaysToDayKey(date, 1)) {
    const shiftWindows: DayAvailability['shiftWindows'] = []
    const timeOff: DayAvailability['timeOff'] = []

    // A11: an exception on ANY of the resource's schedules makes the whole
    // resource unavailable that day. Find the first matching exception (if any)
    // — it suppresses all shift windows and marks the full day as time-off.
    let dayException: RawException | undefined
    for (const sched of schedules as Array<Record<string, unknown>>) {
      const exceptions = (sched.exceptions as RawException[] | undefined) ?? []
      for (const exc of exceptions) {
        const excStart = getDayKeyInTimezone(new Date(exc.date), timeZone)
        const excEnd = exc.endDate ? getDayKeyInTimezone(new Date(exc.endDate), timeZone) : excStart
        if (date >= excStart && date <= excEnd) {
          dayException = exc
          break
        }
      }
      if (dayException) {
        break
      }
    }

    if (dayException) {
      const dayStart = combineDayKeyAndTime(date, '00:00', timeZone)
      const dayEnd = new Date(combineDayKeyAndTime(date, '23:59', timeZone).getTime() + 59_999)
      timeOff.push({
        type: dayException.type,
        end: dayEnd.toISOString(),
        reason: dayException.reason,
        start: dayStart.toISOString(),
      })
    } else {
      for (const sched of schedules as Array<Record<string, unknown>>) {
        // resolveScheduleForDate accepts a Schedule-shaped object; cast through unknown
        const ranges = resolveScheduleForDate(
          sched as unknown as Parameters<typeof resolveScheduleForDate>[0],
          date,
          timeZone,
        )
        for (const r of ranges) {
          shiftWindows.push({ end: r.end.toISOString(), start: r.start.toISOString() })
        }
      }
    }

    days.push({ date, shiftWindows, timeOff })
  }

  const busy = await busyFor({
    blockingStatuses,
    capacityMode,
    end,
    holdsSlug,
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
    const pool = await (payload.findByID as any)({
      id: poolId,
      collection: resourceSlug,
      depth: 0,
    }).catch(() => null)
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
        holdsSlug,
        payload,
        reservationSlug,
        resourceId: poolId,
        start,
      }),
      quantity: (pool.quantity as number) ?? 1,
    })
  }

  // External busy — display only (enforcement lives in checkAvailability).
  // Fail-open: a resolver error must never break the grid.
  let external: ExternalBusyInterval[] = []
  if (getExternalBusy && req) {
    try {
      external = (await getExternalBusy({ end, req, resourceId, start })).filter(
        (iv) => !isNaN(Date.parse(iv.start)) && !isNaN(Date.parse(iv.end)),
      )
    } catch (err) {
      trace.dbg('error', { err, resourceId, where: 'getExternalBusy' })
      external = []
    }
  }

  return { busy, capacityMode, days, external, quantity, requiredPools, timeZone }
}

export function createResourceAvailabilityEndpoint(
  config: ResolvedReservationPluginConfig,
): Endpoint {
  return {
    handler: async (req) => {
      // The grid data (every reservation's busy window) is staff/admin-only —
      // same gate as customer search.
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!isPrivilegedUser(req.user, config)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const dbg = createReserveDebug(req.payload.logger, config.debug)

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
      if (endDate <= startDate) {
        return Response.json({ error: 'end must be after start' }, { status: 400 })
      }
      // Unbounded ranges turn the per-day resolution loop into a CPU sink
      if (endDate.getTime() - startDate.getTime() > MAX_RANGE_MS) {
        return Response.json({ error: 'Date range too large (max 90 days)' }, { status: 400 })
      }

      // Authorization boundary. Delegating to collection access here is what
      // makes owner-mode ownership AND multi-tenant isolation apply — the four
      // reads inside buildResourceAvailability deliberately stay privileged so
      // the busy grid stays complete (see the spec, A4). depth:0 is required:
      // at depth 1 an access-denied `services` relationship populates as null
      // and the requiredResources loop throws on `typeof null === 'object'`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const permitted = await (req.payload.findByID as any)({
        id: resource,
        collection: config.slugs.resources,
        depth: 0,
        overrideAccess: false,
        req,
      }).catch(() => null)

      if (!permitted) {
        dbg.dbg('response', { endpoint: 'resource-availability', reason: 'resource_not_found' })
        return Response.json({ error: 'Resource not found' }, { status: 404 })
      }

      // In multiTenant mode, resolve day-boundaries in the SELECTED tenant's zone
      // (tenant timezone → global → UTC). Degrades to the global zone for plain
      // installs: no tenant relationship on reservations / no tenant cookie ⇒ no
      // DB read, same output as before.
      const reservationsCollection = req.payload.config.collections?.find(
        (c) => c.slug === config.slugs.reservations,
      )
      const timeZone = await getEffectiveTenantTimezone({
        globalTimezone: config.timezone,
        payload: req.payload,
        req,
        scopedCollection: reservationsCollection as { fields?: unknown[] } | undefined,
        tenantField: config.multiTenant.tenantField,
        tenantId: readCookie(req.headers?.get('cookie'), config.multiTenant.cookieName),
        timezoneField: config.multiTenant.timezoneField,
      })

      dbg.dbg('request', { end, endpoint: 'resource-availability', resource, start, timeZone })

      const result = await buildResourceAvailability({
        blockingStatuses: config.statusMachine.blockingStatuses,
        debug: dbg,
        end: endDate,
        getExternalBusy: config.getExternalBusy,
        holdsSlug: config.slotHolds.enabled ? config.slugs.holds : undefined,
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceId: resource,
        resourceSlug: config.slugs.resources,
        scheduleSlug: config.slugs.schedules,
        start: startDate,
        timeZone,
      })

      if (!result) {
        dbg.dbg('response', { endpoint: 'resource-availability', reason: 'resource_not_found' })
        return Response.json({ error: 'Resource not found' }, { status: 404 })
      }

      dbg.dbg('response', {
        dayCount: result.days.length,
        endpoint: 'resource-availability',
        externalCount: result.external.length,
      })
      return Response.json(result)
    },
    method: 'get',
    path: '/reserve/resource-availability',
  }
}

import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { getAvailableSlots } from '../services/AvailabilityService.js'
import { extractId, mergeResourceIds } from '../utilities/resolveRequiredResources.js'
import { getDayKeyInTimezone, isValidDayKey } from '../utilities/timezoneUtils.js'

export function createGetSlotsEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const url = new URL(req.url!)
      const date = url.searchParams.get('date')
      const resource = url.searchParams.get('resource')
      const service = url.searchParams.get('service')

      if (!date || !resource || !service) {
        return Response.json(
          { error: 'Missing required query params: resource, date, service' },
          { status: 400 },
        )
      }

      // YYYY-MM-DD is taken as a business-TZ calendar day verbatim; any other
      // parseable date is re-keyed into the business timezone. Never
      // `new Date('YYYY-MM-DD')` — that pins the day to UTC midnight.
      let dayKey: string
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        if (!isValidDayKey(date)) {
          return Response.json(
            { error: 'Invalid date format. Expected YYYY-MM-DD' },
            { status: 400 },
          )
        }
        dayKey = date
      } else {
        const parsed = new Date(date)
        if (isNaN(parsed.getTime())) {
          return Response.json(
            { error: 'Invalid date format. Expected YYYY-MM-DD' },
            { status: 400 },
          )
        }
        dayKey = getDayKeyInTimezone(parsed, config.timezone)
      }

      const guestCountRaw = Number(url.searchParams.get('guestCount') ?? '1')
      if (!Number.isFinite(guestCountRaw)) {
        return Response.json({ error: 'Invalid guestCount' }, { status: 400 })
      }
      const guestCount = Math.max(Math.floor(guestCountRaw), 1)

      // Resolve required resource set: caller resource(s) ∪ service.requiredResources
      const explicit = url.searchParams.get('resources')
      const callerIds = explicit ? explicit.split(',').map((s) => s.trim()).filter(Boolean) : [resource]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svcDoc = await (req.payload.findByID as any)({
        id: service,
        collection: config.slugs.services,
        depth: 0,
        req,
      }).catch(() => null)
      if (!svcDoc) {
        return Response.json({ error: 'Service not found' }, { status: 404 })
      }

      // Validate the primary resource id up front — a malformed id in a query
      // surfaces as an adapter cast error (500) instead of a clean 404.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resourceDoc = await (req.payload.findByID as any)({
        id: resource,
        collection: config.slugs.resources,
        depth: 0,
        req,
      }).catch(() => null)
      if (!resourceDoc) {
        return Response.json({ error: 'Resource not found' }, { status: 404 })
      }
      const requiredIds = ((svcDoc?.requiredResources as unknown[]) ?? [])
        .map((r) => extractId(r))
        .filter((r): r is number | string => r !== undefined)
      const resourceIds = mergeResourceIds(callerIds, requiredIds)

      const slots = await getAvailableSlots({
        blockingStatuses: config.statusMachine.blockingStatuses,
        date: dayKey,
        getExternalBusy: config.getExternalBusy,
        guestCount,
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceIds,
        resourceSlug: config.slugs.resources,
        scheduleSlug: config.slugs.schedules,
        serviceId: service,
        serviceSlug: config.slugs.services,
        timeZone: config.timezone,
      })

      return Response.json({
        date,
        guestCount,
        slots: slots.map((s) => ({ end: s.end.toISOString(), start: s.start.toISOString() })),
      })
    },
    method: 'get',
    path: '/reserve/slots',
  }
}

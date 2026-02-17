import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { getAvailableSlots } from '../services/AvailabilityService.js'

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

      const parsedDate = new Date(date)
      if (isNaN(parsedDate.getTime())) {
        return Response.json(
          { error: 'Invalid date format. Expected YYYY-MM-DD' },
          { status: 400 },
        )
      }

      const guestCount = Math.max(Number(url.searchParams.get('guestCount') ?? '1'), 1)

      const slots = await getAvailableSlots({
        blockingStatuses: config.statusMachine.blockingStatuses,
        date: parsedDate,
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceId: resource,
        resourceSlug: config.slugs.resources,
        scheduleSlug: config.slugs.schedules,
        serviceId: service,
        serviceSlug: config.slugs.services,
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

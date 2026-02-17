import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { getAvailableSlots } from '../services/AvailabilityService.js'

export function createCheckAvailabilityEndpoint(
  config: ResolvedReservationPluginConfig,
): Endpoint {
  return {
    handler: async (req) => {
      const url = new URL(req.url!)
      const date = url.searchParams.get('date')
      const resource = url.searchParams.get('resource')
      const service = url.searchParams.get('service')

      if (!date || !resource || !service) {
        return Response.json(
          { message: 'Missing required query params: resource, date, service' },
          { status: 400 },
        )
      }

      const slots = await getAvailableSlots({
        blockingStatuses: config.statusMachine.blockingStatuses,
        date: new Date(date),
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceId: resource,
        resourceSlug: config.slugs.resources,
        scheduleSlug: config.slugs.schedules,
        serviceId: service,
        serviceSlug: config.slugs.services,
      })

      return Response.json({ slots })
    },
    method: 'get',
    path: '/reserve/availability',
  }
}

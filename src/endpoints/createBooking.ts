import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const data = (await req.json?.()) as Record<string, unknown>

      // Call beforeBookingCreate plugin hooks before creating the reservation
      let bookingData = data
      if (config.hooks?.beforeBookingCreate) {
        for (const hook of config.hooks.beforeBookingCreate) {
          bookingData = (await hook({ data: bookingData, req })) ?? bookingData
        }
      }

      // Create via Payload Local API — collection hooks handle conflict detection,
      // endTime calculation, and status transitions
      const reservation = await req.payload.create({
        collection: config.slugs.reservations as 'reservations',
        data: bookingData,
        req,
      })

      return Response.json(reservation, { status: 201 })
    },
    method: 'post',
    path: '/reserve/book',
  }
}

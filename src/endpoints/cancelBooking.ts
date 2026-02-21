import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createCancelBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ message: 'Unauthorized' }, { status: 401 })
      }

      const body = await req.json?.()
      const { reason, reservationId } = (body ?? {}) as {
        reason?: string
        reservationId?: string
      }

      if (!reservationId) {
        return Response.json({ message: 'reservationId is required' }, { status: 400 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reservation = await (req.payload.update as any)({
        id: reservationId,
        collection: config.slugs.reservations,
        data: {
          cancellationReason: reason,
          status: 'cancelled',
        },
        req,
      })

      return Response.json(reservation)
    },
    method: 'post',
    path: '/reserve/cancel',
  }
}

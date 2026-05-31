import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createCancelBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const body = await req.json?.()
      const { reason, reservationId, token } = (body ?? {}) as {
        reason?: string
        reservationId?: string
        token?: string
      }

      if (!reservationId) {
        return Response.json({ message: 'reservationId is required' }, { status: 400 })
      }

      // Fetch the reservation to check ownership / token.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (req.payload.findByID as any)({
        id: reservationId,
        collection: config.slugs.reservations,
        depth: 0,
        overrideAccess: true,
        req,
      })

      if (req.user) {
        // Authenticated path: owner (customer === req.user) or admin (non-customer collection).
        const customerId =
          typeof existing.customer === 'object' ? existing.customer?.id : existing.customer
        const isOwner = customerId === req.user.id
        const isAdmin = req.user.collection !== config.slugs.customers
        if (!isOwner && !isAdmin) {
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
      } else {
        // Guest path: match the cancellation token.
        if (!token || !existing.cancellationToken || token !== existing.cancellationToken) {
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
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

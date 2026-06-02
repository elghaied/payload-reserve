import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { isPrivilegedUser } from '../utilities/userRoles.js'

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

      // Fetch the reservation to check ownership
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (req.payload.findByID as any)({
        id: reservationId,
        collection: config.slugs.reservations,
        depth: 0,
        req,
      })

      // Check ownership: customer must match req.user
      const customerId =
        typeof existing.customer === 'object' ? existing.customer?.id : existing.customer
      const isOwner = customerId === req.user.id
      // Staff/admin detection (role-aware for single-collection deployments)
      const isAdmin = isPrivilegedUser(req.user, config)

      if (!isOwner && !isAdmin) {
        return Response.json({ message: 'Forbidden' }, { status: 403 })
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

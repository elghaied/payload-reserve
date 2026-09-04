import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { flattenRelations } from '../utilities/flattenRelations.js'
import {
  isTransientWriteConflict,
  retryOnWriteConflict,
} from '../utilities/retryOnWriteConflict.js'
import { isPrivilegedUser } from '../utilities/userRoles.js'

export function createCancelBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      let body: unknown
      try {
        body = await req.json?.()
      } catch {
        return Response.json({ message: 'Invalid JSON body' }, { status: 400 })
      }
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
        // A malformed id is an adapter cast error on Postgres/SQLite (a 500
        // from an endpoint reachable without authentication); both shapes
        // mean "no such reservation".
        disableErrors: true,
        overrideAccess: true,
        req,
      }).catch(() => null)
      if (!existing) {
        return Response.json({ message: 'Reservation not found' }, { status: 404 })
      }

      // Chosen per authorization path, then applied to the update below:
      //  - guest with a matching token: the token IS the authorization
      //  - owner: owner-mode's `update: adminOnly` would otherwise wrongly
      //    block a customer cancelling their own booking
      //  - privileged non-owner: delegate, so owner-mode AND multi-tenant
      //    isolation both apply
      let delegateAccess = false

      if (req.user) {
        // Authenticated path: owner (customer === req.user) or admin/staff.
        const customerId =
          typeof existing.customer === 'object' ? existing.customer?.id : existing.customer
        const isOwner = customerId === req.user.id
        // Staff/admin detection (role-aware for single-collection deployments)
        const isAdmin = isPrivilegedUser(req.user, config)
        if (!isOwner && !isAdmin) {
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
        delegateAccess = !isOwner
      } else {
        // Guest path: match the cancellation token.
        if (!token || !existing.cancellationToken || token !== existing.cancellationToken) {
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
      }

      let reservation: Record<string, unknown>
      try {
        reservation = await retryOnWriteConflict(
          () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (req.payload.update as any)({
              id: reservationId,
              collection: config.slugs.reservations,
              data: {
                cancellationReason: reason,
                status: config.statusMachine.cancelStatus,
              },
              overrideAccess: !delegateAccess,
              req,
            }) as Promise<Record<string, unknown>>,
          { req },
        )
      } catch (err) {
        if (isTransientWriteConflict(err)) {
          return Response.json(
            { error: 'That booking is being modified. Please try again.', retryable: true },
            { status: 409 },
          )
        }
        // A denied delegate write is an authorization failure, not a 500.
        if ((err as { status?: number })?.status === 403) {
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
        throw err
      }

      // Strip the cancellation token from the response, consistent with the book
      // endpoint — it must never be echoed back over HTTP.
      // Re-read at depth 0 — see createBooking: the update ran with access
      // overridden for the owner/guest paths, so the raw doc is populated past
      // field-level read access.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flat = (await (req.payload.findByID as any)({
        id: reservation.id,
        collection: config.slugs.reservations,
        depth: 0,
        disableErrors: true,
        req,
      }).catch(() => null)) as null | Record<string, unknown>
      const { cancellationToken: _cancellationToken, ...safeReservation } =
        flat ?? flattenRelations(reservation)

      return Response.json(safeReservation)
    },
    method: 'post',
    path: '/reserve/cancel',
  }
}

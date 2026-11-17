import type { Endpoint } from 'payload'

import { timingSafeEqual } from 'node:crypto'

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
        return Response.json({ error: 'Invalid JSON body', message: 'Invalid JSON body' }, { status: 400 })
      }
      const { reason, reservationId, token } = (body ?? {}) as Record<string, unknown>

      // Everything here comes from an unauthenticated JSON body: only an id-shaped
      // reservationId and string token/reason go any further.
      if (
        (typeof reservationId !== 'string' && typeof reservationId !== 'number') ||
        reservationId === ''
      ) {
        return Response.json({ error: 'reservationId is required', message: 'reservationId is required' }, { status: 400 })
      }
      if (
        (token !== undefined && token !== null && typeof token !== 'string') ||
        (reason !== undefined && reason !== null && typeof reason !== 'string')
      ) {
        return Response.json({ error: 'token and reason must be strings', message: 'token and reason must be strings' }, { status: 400 })
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
        return Response.json({ error: 'Reservation not found', message: 'Reservation not found' }, { status: 404 })
      }

      // Chosen per authorization path, then applied to the update below:
      //  - guest with a matching token: the token IS the authorization
      //  - owner: owner-mode's `update: adminOnly` would otherwise wrongly
      //    block a customer cancelling their own booking
      //  - privileged non-owner: delegate, so owner-mode AND multi-tenant
      //    isolation both apply
      let delegateAccess = false
      // True when the cancellation token is the caller's only authorization.
      let viaGuestToken = false

      const customerId =
        typeof existing.customer === 'object' ? existing.customer?.id : existing.customer
      // Owner means a CUSTOMERS-collection user whose id is the booking's
      // customer. Comparing ids alone made staff user #5 the "owner" of every
      // booking of customer #5 on a SQL adapter (each collection numbers from
      // 1), which skipped the delegation below.
      const isOwner =
        req.user != null &&
        req.user.collection === config.slugs.customers &&
        customerId != null &&
        String(customerId) === String(req.user.id)
      // Staff/admin detection (role-aware for single-collection deployments)
      const isAdmin = isPrivilegedUser(req.user, config)

      if (isOwner || isAdmin) {
        delegateAccess = !isOwner
      } else {
        // Guest path — also for a logged-in caller who is neither owner nor
        // staff but holds the token (booked as a guest, signed in later).
        const stored = existing.cancellationToken as string | undefined
        const a = Buffer.from(typeof token === 'string' ? token : '')
        const b = Buffer.from(stored ?? '')
        if (!stored || a.length !== b.length || !timingSafeEqual(a, b)) {
          return Response.json({ error: 'Forbidden', message: 'Forbidden' }, { status: 403 })
        }
        viaGuestToken = true
      }

      let reservation: Record<string, unknown>
      try {
        reservation = await retryOnWriteConflict(
          () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (req.payload.update as any)({
              id: reservationId,
              collection: config.slugs.reservations,
              // A token holder is a customer, not trusted host code:
              // validateCancellation reads this to apply the customer rules.
              ...(viaGuestToken ? { context: { publicCancel: true } } : {}),
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
          return Response.json({ error: 'Forbidden', message: 'Forbidden' }, { status: 403 })
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
        overrideAccess: true,
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

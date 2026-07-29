import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import {
  isTransientWriteConflict,
  retryOnWriteConflict,
} from '../utilities/retryOnWriteConflict.js'
import { isPrivilegedUser } from '../utilities/userRoles.js'

export function createBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const data = (await req.json?.()) as Record<string, unknown>

      // Cancellation tokens are server-generated secrets — never accept one
      // from the request body.
      delete data.cancellationToken

      // Who may book for whom: staff/admin for anyone (walk-ins); an
      // authenticated customer only for themselves; anonymous callers never
      // for an existing customer record (the guest flow covers them).
      if (!isPrivilegedUser(req.user, config)) {
        if (req.user) {
          data.customer = req.user.id
        } else if (data.customer) {
          return Response.json(
            { error: 'Anonymous bookings cannot set a customer' },
            { status: 403 },
          )
        }
      }

      // Create via Payload Local API — collection hooks handle conflict detection,
      // endTime calculation, status transitions, AND the beforeBookingCreate
      // plugin hooks (running them here too made them fire twice per booking).
      //
      // Retry only transient write conflicts. acquireBookingLock makes concurrent
      // bookings for one resource contend on a single document; on MongoDB the
      // loser aborts rather than waiting, so without this a legitimate booking on
      // a quantity>1 resource fails purely because it lost a race.
      let reservation: Record<string, unknown>
      try {
        reservation = await retryOnWriteConflict(
          () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (req.payload.create as any)({
              collection: config.slugs.reservations,
              data,
              req,
            }) as Promise<Record<string, unknown>>,
        )
      } catch (err) {
        // A conflict that survived every attempt is contention, not a bad request:
        // the caller should try again rather than change anything.
        if (isTransientWriteConflict(err)) {
          return Response.json(
            {
              error: 'That slot is being booked by someone else. Please try again.',
              retryable: true,
            },
            { status: 409 },
          )
        }
        throw err
      }

      // Never expose the cancellation token in the HTTP response — it is delivered
      // to the guest by the host project via the afterBookingCreate hook.
      const { cancellationToken: _cancellationToken, ...safeReservation } = reservation

      return Response.json(safeReservation, { status: 201 })
    },
    method: 'post',
    path: '/reserve/book',
  }
}

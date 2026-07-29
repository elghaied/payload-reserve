import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import {
  isTransientWriteConflict,
  retryOnWriteConflict,
} from '../utilities/retryOnWriteConflict.js'
import { callerMayUseTenant } from '../utilities/tenantTimezone.js'
import { isPrivilegedUser } from '../utilities/userRoles.js'

export function createBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const data = (await req.json?.()) as Record<string, unknown>

      // Cancellation tokens are server-generated secrets — never accept one
      // from the request body.
      delete data.cancellationToken

      // A hold token is a bearer secret, not booking data: it must reach the
      // conflict check via context (so the hold does not block the booking it
      // was taken to protect) and must never be persisted on the reservation.
      const holdToken = typeof data.holdToken === 'string' ? data.holdToken : undefined
      delete data.holdToken

      const privileged = isPrivilegedUser(req.user, config)

      // Who may book for whom: staff/admin for anyone (walk-ins); an
      // authenticated customer only for themselves; anonymous callers never
      // for an existing customer record (the guest flow covers them).
      if (!privileged) {
        if (req.user) {
          data.customer = req.user.id
        } else if (data.customer) {
          return Response.json(
            { error: 'Anonymous bookings cannot set a customer' },
            { status: 403 },
          )
        }
      }

      // `overrideAccess` and the tenant-membership probe below are two
      // INDEPENDENT gates, not one derived from the other (maintainer ruling):
      //
      //   anonymous guest       -> privileged (no user to authorize)
      //   customer books SELF   -> privileged + tenant probe
      //   any other authed call -> delegates  + tenant probe
      //
      // A self-booking customer is forced onto their own id just above, so
      // delegating collection access there protects against nothing — it only
      // costs correctness, tripping resourceOwnerMode's reservation `create`
      // access (admin-only) and breaking ordinary self-service booking.
      // Staying privileged for that path is safe precisely BECAUSE the tenant
      // probe (not overrideAccess) is what actually closes the cross-tenant
      // hole, so it runs on every authenticated path below regardless of which
      // way this flag goes.
      const delegateAccess = privileged

      // See callerMayUseTenant's doc comment (src/utilities/tenantTimezone.ts)
      // for the full mechanism and its precondition. Runs for every
      // authenticated caller — including the privileged self-booking path
      // above — since it is independent of overrideAccess.
      if (req.user) {
        const permitted = await callerMayUseTenant({ config, data, req })
        if (!permitted) {
          return Response.json({ error: 'Not permitted to create this booking' }, { status: 403 })
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
              context: holdToken ? { holdToken } : undefined,
              data,
              overrideAccess: !delegateAccess,
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
        // A denied delegate write is an authorization failure, not a 500.
        if ((err as { status?: number })?.status === 403) {
          return Response.json({ error: 'Not permitted to create this booking' }, { status: 403 })
        }
        throw err
      }

      // Consume the hold now that the booking exists. Failure here must not fail
      // the booking — the hold expires on its own, and a stale hold only ever
      // blocks the slot for its remaining TTL.
      if (holdToken) {
        try {
          await req.payload.delete({
            collection: config.slugs.holds,
            req,
            where: { token: { equals: holdToken } },
          })
        } catch (err) {
          req.payload.logger.warn({
            err,
            msg: 'payload-reserve: booking created but its hold could not be released',
          })
        }
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

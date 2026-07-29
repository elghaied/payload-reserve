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

      // The write stays PRIVILEGED for every caller, and the tenant-membership
      // probe below is the security boundary (maintainer ruling). Applying that
      // ruling consistently is what makes this endpoint's behaviour identical to
      // pre-`slotHolds` releases for collection access — it never passed
      // `overrideAccess`, so the Local API default (`true`) applied to
      // everyone — while still closing the cross-tenant write.
      //
      // Delegating for any subset of callers is not a security improvement and
      // is a real regression: `isPrivilegedUser` is true for ANY user outside
      // `slugs.customers`, so delegating on that branch made a non-admin staff
      // or resource-owner account hit `resourceOwnerMode`'s admin-only
      // reservation `create` access (`makeReservationOwnerAccess` in
      // src/utilities/ownerAccess.ts) and get a flat 403 for a walk-in booking
      // they could take before. And it buys nothing, because Payload's `create`
      // access check only tests the TRUTHINESS of an access function's result —
      // a returned `Where` (how multi-tenant scopes access) is discarded, so
      // `overrideAccess: false` cannot constrain WHICH tenant is written to.
      // Only the probe can. See README, "/api/reserve/book: the tenant probe is
      // the gate, not overrideAccess".

      // See callerMayUseTenant's doc comment (src/utilities/tenantTimezone.ts)
      // for the full mechanism and its precondition. Unconditional on
      // `req.user`: it is what authorizes an explicit `tenant` in the body, and
      // it is independent of the privileged write above.
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
              overrideAccess: true,
              req,
            }) as Promise<Record<string, unknown>>,
          { req },
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
        // An access denial raised anywhere under the create (a consumer hook,
        // a field-level rule) is an authorization failure, not a 500.
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

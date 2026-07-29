import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import {
  isTransientWriteConflict,
  retryOnWriteConflict,
} from '../utilities/retryOnWriteConflict.js'
import { collectionHasTenantField } from '../utilities/tenantFilter.js'
import { tenantCollectionSlug } from '../utilities/tenantTimezone.js'
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

      // Per-path, exactly as cancelBooking does. An anonymous guest booking has
      // no user to authorize, so it must stay privileged — collection access
      // would reject it outright. An AUTHENTICATED caller delegates, which is
      // what makes multi-tenant isolation apply: MT's tenant-field validate only
      // checks presence, and its membership-checked defaultValue applies only
      // when no tenant was supplied, so an explicit foreign tenant otherwise
      // sails through.
      const delegateAccess = Boolean(req.user)

      // The delegation above is necessary but not sufficient for `tenant`
      // specifically: Payload's create operation only checks the TRUTHINESS of
      // a collection access result (executeAccess), never applies it as a
      // filter — that only happens for read/update/delete, which operate on a
      // real document. MT's own tenant-scoped create access therefore can't
      // reject an explicit foreign tenant either; empirically (see
      // dev/tenantScoping.int.spec.ts) the `overrideAccess: false` above does
      // NOT by itself stop a tenant-A caller from writing `tenant: <tenantB>`.
      // Close it the same way `getEffectiveTenantTimezone` closes the same gap
      // for a client-supplied tenant cookie: an access-checked probe read on
      // the tenants collection, which MT DOES filter by membership for reads.
      if (delegateAccess && typeof data.tenant === 'string') {
        const reservationsCollection = req.payload.config.collections?.find(
          (c) => c.slug === config.slugs.reservations,
        ) as { fields?: unknown[] } | undefined
        const tenantSlug = collectionHasTenantField(
          reservationsCollection,
          config.multiTenant.tenantField,
        )
          ? tenantCollectionSlug(reservationsCollection, config.multiTenant.tenantField)
          : null
        if (tenantSlug) {
          const permittedTenant = await (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            req.payload.findByID as any
          )({
            id: data.tenant,
            collection: tenantSlug,
            depth: 0,
            overrideAccess: false,
            req,
          }).catch(() => null)
          if (!permittedTenant) {
            return Response.json({ error: 'Not permitted to create this booking' }, { status: 403 })
          }
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

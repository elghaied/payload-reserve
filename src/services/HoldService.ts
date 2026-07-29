import type { PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { isTransientWriteConflict } from '../utilities/retryOnWriteConflict.js'
import { computeEndTime } from './AvailabilityService.js'

/**
 * Why a hold was refused — a CLOSED set, deliberately.
 *
 * `/reserve/hold` is reachable without authentication, so the refusal reason is
 * attacker-visible output. An earlier version echoed `error.message` from any
 * failed write, which leaked internal detail (DB errors, `Forbidden`, genuine
 * bugs) and reported all of it as `409 slot_taken` — a status that tells a
 * well-behaved client the slot is gone and it should stop, for conditions that
 * are nothing of the sort. Everything not enumerated here now propagates as a
 * thrown error, so it surfaces as a 500 the operator can see rather than a
 * plausible-looking 409 the caller cannot act on.
 */
export type HoldRefusalReason =
  | 'resource_not_found'
  | 'service_inactive'
  | 'service_not_found'
  | 'slot_taken'

export type TakeHoldResult =
  | { hold: { expiresAt: string; id: number | string; token: string }; ok: true }
  | { ok: false; reason: HoldRefusalReason }

/**
 * Claim a slot for `config.slotHolds.ttlMinutes` while the caller completes an
 * external step (typically payment).
 *
 * This function only assembles the row. The parts that make a hold trustworthy
 * — claiming the resource lock and running the same `checkAvailability` a
 * booking runs — live in the `validateHoldSlot` beforeChange hook, because they
 * must share the transaction Payload opens around `create`. Doing them here
 * instead granted 3 of 8 simultaneous holds for one slot.
 */
export async function takeHold(params: {
  config: ResolvedReservationPluginConfig
  endTime?: Date
  guestCount?: number
  req: PayloadRequest
  resourceId: number | string
  serviceId: number | string
  startTime: Date
}): Promise<TakeHoldResult> {
  const { config, guestCount = 1, req, resourceId, serviceId, startTime } = params
  const { payload } = req

  // `disableErrors` is what makes the `!service` guard below reachable at all:
  // without it `findByID` THROWS `NotFound`, and this call sits outside the
  // try/catch, so a bad service id escaped as a raw 404 while a bad resource id
  // came back as a 409 with an internal message. The trailing `.catch` covers
  // the adapter's own cast error for a malformed id (the same treatment
  // `/reserve/availability` and `/reserve/slots` already give it) — to a caller
  // both mean exactly "no such service".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = await (payload.findByID as any)({
    id: serviceId,
    collection: config.slugs.services,
    depth: 0,
    disableErrors: true,
    joins: false,
    req,
  }).catch(() => null)

  if (!service) {
    return { ok: false, reason: 'service_not_found' }
  }

  if (config.enforceActive && service.active === false) {
    return { ok: false, reason: 'service_inactive' }
  }

  // Same treatment for the resource. `validateHoldSlot` writes the resource's
  // booking lock through `payload.db.updateOne`, which for an unknown or
  // malformed id throws an adapter-level error — previously echoed verbatim as
  // a 409. Resolving it here turns it into a clean 404.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resource = await (payload.findByID as any)({
    id: resourceId,
    collection: config.slugs.resources,
    depth: 0,
    disableErrors: true,
    req,
  }).catch(() => null)

  if (!resource) {
    return { ok: false, reason: 'resource_not_found' }
  }

  const { endTime } = computeEndTime({
    durationType: (service.durationType as 'fixed') ?? 'fixed',
    endTime: params.endTime,
    serviceDuration: (service.duration as number) ?? 0,
    startTime,
    timeZone: config.timezone,
  })

  // Expired-row sweep. Purely hygienic — every read already filters on
  // expiresAt — so it must never fail the hold.
  try {
    await payload.delete({
      collection: config.slugs.holds,
      req,
      where: { expiresAt: { less_than: new Date().toISOString() } },
    })
  } catch {
    // Ignored by design: expiry is enforced at read time, not by this sweep.
    //
    // But swallowing the error is not enough to keep that promise. If this
    // delete's `beginTransaction` REJECTED, `initTransaction` already stored the
    // rejected promise on `req.transactionID` and `killTransaction`'s guard
    // skips promises — so the `create` below would short-circuit inside
    // `initTransaction` and rethrow THE SWEEP'S error, failing the hold on
    // behalf of a step documented as never able to. `retryOnWriteConflict`'s
    // between-attempts clearing cannot reach this: the poisoning happens
    // mid-attempt. Clearing it here restores the invariant.
    //
    // This cannot drop a live transaction. A sweep that COMMITTED cleared the id
    // itself; a sweep that failed any other way had `killTransaction` clear it
    // (Payload does that unconditionally, even for an id it only joined). The
    // poisoned promise is the one shape that can still be sitting here.
    if (req.transactionID !== undefined) {
      delete req.transactionID
    }
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + config.slotHolds.ttlMinutes * 60_000).toISOString()

  // The lock, the availability check and this insert must share one
  // transaction for the lock to serialize anything — Payload opens that
  // transaction around `create`, and validateHoldSlot runs inside it.
  let created: { id: number | string }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    created = await (payload.create as any)({
      collection: config.slugs.holds,
      data: {
        customer: req.user?.id,
        endTime: endTime.toISOString(),
        expiresAt,
        guestCount,
        resource: resourceId,
        service: serviceId,
        startTime: startTime.toISOString(),
        token,
      },
      req,
    })
  } catch (error) {
    // A lost lock race must REJECT, not resolve: `retryOnWriteConflict` (which
    // wraps every caller of this function) only retries a rejected promise, so
    // returning here made the whole retry wrapper inert and collapsed a
    // `quantity: 3` resource to one hold under a burst.
    if (isTransientWriteConflict(error)) {
      throw error
    }
    // validateHoldSlot signals genuine unavailability — the slot is booked,
    // held, out of capacity, or the service went inactive — as a
    // ValidationError. That is the only refusal this catch recognises.
    if (error instanceof ValidationError) {
      return { ok: false, reason: 'slot_taken' }
    }
    // Anything else is a real failure, not a refusal. Propagate it rather than
    // dressing it up as a 409 carrying its own message.
    throw error
  }

  return { hold: { id: created.id, expiresAt, token }, ok: true }
}

/** Release a hold early. Idempotent: releasing an unknown token is not an error. */
export async function releaseHold(params: {
  config: ResolvedReservationPluginConfig
  req: PayloadRequest
  token: string
}): Promise<{ released: number }> {
  const { config, req, token } = params

  const { docs } = await req.payload.delete({
    collection: config.slugs.holds,
    req,
    where: { token: { equals: token } },
  })

  return { released: docs.length }
}

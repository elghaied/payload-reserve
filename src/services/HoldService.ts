import type { PayloadRequest } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { isTransientWriteConflict } from '../utilities/retryOnWriteConflict.js'
import { computeEndTime } from './AvailabilityService.js'

/**
 * Why a hold was refused. A conflict surfaces as a ValidationError from
 * validateHoldSlot; a lost lock race surfaces as a transient write conflict,
 * which for a hold means the same thing to the caller — the slot went to
 * someone else.
 */
function reasonFor(error: unknown): string {
  if (isTransientWriteConflict(error)) {
    return 'slot_taken'
  }
  const message = (error as { message?: unknown })?.message
  return typeof message === 'string' && message ? message : 'unavailable'
}

export type TakeHoldResult =
  | { hold: { expiresAt: string; id: number | string; token: string }; ok: true }
  | { ok: false; reason: string }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = await (payload.findByID as any)({
    id: serviceId,
    collection: config.slugs.services,
    depth: 0,
    joins: false,
    req,
  })

  if (!service) {
    return { ok: false, reason: 'service_not_found' }
  }

  if (config.enforceActive && service.active === false) {
    return { ok: false, reason: 'service_inactive' }
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
    return { ok: false, reason: reasonFor(error) }
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

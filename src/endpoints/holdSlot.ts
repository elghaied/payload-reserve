import type { Endpoint } from 'payload'

import type { HoldRefusalReason } from '../services/HoldService.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { takeHold } from '../services/HoldService.js'
import {
  isTransientWriteConflict,
  retryOnWriteConflict,
} from '../utilities/retryOnWriteConflict.js'

/**
 * HTTP status per refusal reason. Exhaustive over the closed
 * {@link HoldRefusalReason} union on purpose — a new reason cannot be added
 * without deciding its status, which is how every failure used to collapse into
 * a single 409 carrying an internal message.
 */
const REFUSAL_STATUS: Record<HoldRefusalReason, number> = {
  invalid_window: 400,
  outside_schedule: 409,
  resource_not_found: 404,
  service_inactive: 409,
  service_not_found: 404,
  slot_taken: 409,
}

/**
 * Claim a slot while the caller completes checkout.
 *
 * Retried for the same reason a booking is: taking a hold writes the resource's
 * bookingLock, so two simultaneous callers contend on one document and MongoDB
 * aborts the loser rather than making it wait. `takeHold` therefore RETHROWS a
 * transient conflict instead of returning it — the wrapper below only retries a
 * rejected promise.
 */
export function createHoldSlotEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      let body: Record<string, unknown>
      try {
        body = (await req.json?.()) as Record<string, unknown>
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Response.json({ error: 'A JSON object body is required' }, { status: 400 })
      }

      const resource = body.resource as number | string | undefined
      const service = body.service as number | string | undefined
      const startTime = body.startTime as string | undefined

      if (!resource || !service || !startTime) {
        return Response.json(
          { error: 'resource, service and startTime are required' },
          { status: 400 },
        )
      }

      const parsedStart = new Date(startTime)
      if (isNaN(parsedStart.getTime())) {
        return Response.json({ error: 'startTime is not a valid date' }, { status: 400 })
      }

      // `endTime` reaches `computeEndTime` unchanged for a `flexible`-duration
      // service, so an unparseable one became an Invalid Date whose
      // `.toISOString()` threw a RangeError deep inside `takeHold` — neither a
      // transient conflict nor a ValidationError, so it correctly propagated as
      // a 500 from an endpoint reachable without authentication. Bad input is a
      // 400, and it is cheaper to say so here.
      let parsedEnd: Date | undefined
      if (body.endTime !== undefined && body.endTime !== null) {
        parsedEnd = new Date(body.endTime as string)
        if (isNaN(parsedEnd.getTime())) {
          return Response.json({ error: 'endTime is not a valid date' }, { status: 400 })
        }
      }

      // `guestCount` is `min: 1` on the collection, and the field-level failure
      // it raises is a Payload ValidationError — indistinguishable inside
      // `takeHold` from the ValidationError `validateHoldSlot` raises for genuine
      // unavailability, so `{ guestCount: 0 }` answered `409 slot_taken`: a
      // well-behaved client is told the slot is gone and to stop retrying,
      // for a malformed request. Rejecting it here keeps that 409 meaning only
      // what it says.
      let guestCount = 1
      if (body.guestCount !== undefined && body.guestCount !== null) {
        const raw = body.guestCount
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
          return Response.json(
            { error: 'guestCount must be an integer of 1 or more' },
            { status: 400 },
          )
        }
        guestCount = raw
      }

      let result: Awaited<ReturnType<typeof takeHold>>
      try {
        result = await retryOnWriteConflict(
          () =>
            takeHold({
              config,
              endTime: parsedEnd,
              guestCount,
              req,
              resourceId: resource,
              serviceId: service,
              startTime: parsedStart,
            }),
          { req },
        )
      } catch (err) {
        // A conflict that survived every attempt is contention, not a verdict on
        // the slot — mirrors /reserve/book's mapping so a client can distinguish
        // "try again" from "gone".
        if (isTransientWriteConflict(err)) {
          return Response.json(
            {
              error: 'That slot is being claimed by someone else. Please try again.',
              retryable: true,
            },
            { status: 409 },
          )
        }
        throw err
      }

      if (!result.ok) {
        return Response.json(
          { error: result.reason, ...(result.detail ? { detail: result.detail } : {}) },
          { status: REFUSAL_STATUS[result.reason] },
        )
      }

      return Response.json(
        { expiresAt: result.hold.expiresAt, token: result.hold.token },
        { status: 201 },
      )
    },
    method: 'post',
    path: '/reserve/hold',
  }
}

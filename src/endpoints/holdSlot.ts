import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { takeHold } from '../services/HoldService.js'
import { retryOnWriteConflict } from '../utilities/retryOnWriteConflict.js'

/**
 * Claim a slot while the caller completes checkout.
 *
 * Retried for the same reason a booking is: taking a hold writes the resource's
 * bookingLock, so two simultaneous callers contend on one document and MongoDB
 * aborts the loser rather than making it wait.
 */
export function createHoldSlotEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const body = (await req.json?.()) as Record<string, unknown>

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

      const result = await retryOnWriteConflict(() =>
        takeHold({
          config,
          endTime: body.endTime ? new Date(body.endTime as string) : undefined,
          guestCount: (body.guestCount as number) ?? 1,
          req,
          resourceId: resource,
          serviceId: service,
          startTime: parsedStart,
        }),
      )

      if (!result.ok) {
        // The slot is unavailable, not the request malformed.
        return Response.json({ error: result.reason }, { status: 409 })
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

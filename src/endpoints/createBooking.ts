import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createBookingEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      const data = (await req.json?.()) as Record<string, unknown>

      // Create via Payload Local API — collection hooks handle conflict detection,
      // endTime calculation, status transitions, AND the beforeBookingCreate
      // plugin hooks (running them here too made them fire twice per booking).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reservation = await (req.payload.create as any)({
        collection: config.slugs.reservations,
        data,
        req,
      })

      // Never expose the cancellation token in the HTTP response — it is delivered
      // to the guest by the host project via the afterBookingCreate hook.
      const { cancellationToken: _cancellationToken, ...safeReservation } =
        reservation as Record<string, unknown>

      return Response.json(safeReservation, { status: 201 })
    },
    method: 'post',
    path: '/reserve/book',
  }
}

import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { releaseHold } from '../services/HoldService.js'

/**
 * Release a hold early. Idempotent by design: a client that retries after a
 * network blip, or releases a hold that already expired and was swept, gets a
 * 200 with released: 0 rather than an error it cannot act on.
 */
export function createReleaseSlotEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      let body: Record<string, unknown>
      try {
        body = (await req.json?.()) as Record<string, unknown>
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      const token = body && typeof body === 'object' ? (body.token as string | undefined) : undefined

      if (!token) {
        return Response.json({ error: 'token is required' }, { status: 400 })
      }

      const { released } = await releaseHold({ config, req, token })
      return Response.json({ released }, { status: 200 })
    },
    method: 'post',
    path: '/reserve/hold/release',
  }
}

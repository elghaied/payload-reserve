import type { Endpoint, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { isPrivilegedUser } from '../utilities/userRoles.js'

const MAX_RESOURCES = 100
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Unexpired slot holds for a set of resources over a date range, for the admin
 * availability grid. Staff only, and never returns a hold's `token` — the token
 * is a bearer secret (see Holds.ts), which is why the collection's own REST API
 * stays closed and this endpoint exists instead.
 */
export function createHeldSlotsEndpoint(config: ResolvedReservationPluginConfig): Endpoint {
  return {
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!isPrivilegedUser(req.user, config)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      const url = new URL(req.url!)
      const ids = (url.searchParams.get('resources') ?? '').split(',').filter(Boolean)
      const start = new Date(url.searchParams.get('start') ?? '')
      const end = new Date(url.searchParams.get('end') ?? '')

      if (ids.length === 0 || isNaN(start.getTime()) || isNaN(end.getTime())) {
        return Response.json(
          { error: 'Missing or invalid query params: resources, start, end' },
          { status: 400 },
        )
      }
      if (ids.length > MAX_RESOURCES) {
        return Response.json(
          { error: `resources accepts at most ${MAX_RESOURCES} ids` },
          { status: 400 },
        )
      }
      if (end <= start || end.getTime() - start.getTime() > MAX_RANGE_MS) {
        return Response.json(
          { error: 'end must be after start, at most 90 days later' },
          { status: 400 },
        )
      }

      // Authorization boundary: keep only the resources this caller may read, so
      // owner mode and tenant isolation apply. The holds read below is privileged
      // because the holds collection is closed to everyone by design.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const permitted = await (req.payload.find as any)({
        collection: config.slugs.resources,
        depth: 0,
        disableErrors: true,
        limit: MAX_RESOURCES,
        overrideAccess: false,
        pagination: false,
        req,
        where: { id: { in: ids } },
      })
      const allowed = ((permitted?.docs ?? []) as Array<{ id: number | string }>).map((r) => r.id)
      if (allowed.length === 0) {
        return Response.json({ holds: [] })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { docs } = await (req.payload.find as any)({
        collection: config.slugs.holds,
        depth: 0,
        limit: 0,
        overrideAccess: true,
        req,
        where: {
          and: [
            { resource: { in: allowed } },
            { expiresAt: { greater_than: new Date().toISOString() } },
            { startTime: { less_than: end.toISOString() } },
            { endTime: { greater_than: start.toISOString() } },
          ],
        } as Where,
      })

      return Response.json({
        holds: (docs as Array<Record<string, unknown>>).map((hold) => ({
          endTime: hold.endTime,
          expiresAt: hold.expiresAt,
          resource: hold.resource,
          startTime: hold.startTime,
        })),
      })
    },
    method: 'get',
    path: '/reserve/held',
  }
}

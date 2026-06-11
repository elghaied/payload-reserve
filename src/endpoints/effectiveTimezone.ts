import type { Endpoint } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { readCookie } from '../utilities/tenantFilter.js'
import { getEffectiveTenantTimezone } from '../utilities/tenantTimezone.js'

/**
 * Resolve the effective business timezone for the current request's selected
 * tenant (tenant zone → global → UTC), read from the tenant cookie. The custom
 * admin calendar calls this so its day-boundary rendering matches the selected
 * tenant — the client can't resolve it itself because the tenant→timezone map
 * lives server-side and the tenant collection slug is only known at request time.
 *
 * Plain (non-multiTenant) installs always get `config.timezone` here, with no
 * tenant DB read.
 */
export function createEffectiveTimezoneEndpoint(
  config: ResolvedReservationPluginConfig,
): Endpoint {
  return {
    handler: async (req) => {
      // Staff/admin-only view data — require an authenticated user.
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const reservationsCollection = req.payload.config.collections?.find(
        (c) => c.slug === config.slugs.reservations,
      )
      const timeZone = await getEffectiveTenantTimezone({
        globalTimezone: config.timezone,
        payload: req.payload,
        scopedCollection: reservationsCollection as { fields?: unknown[] } | undefined,
        tenantField: config.multiTenant.tenantField,
        tenantId: readCookie(req.headers?.get('cookie'), config.multiTenant.cookieName),
        timezoneField: config.multiTenant.timezoneField,
      })

      return Response.json({ timeZone })
    },
    method: 'get',
    path: '/reserve/effective-timezone',
  }
}

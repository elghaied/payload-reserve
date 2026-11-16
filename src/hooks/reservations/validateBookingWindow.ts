import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { mergeReservationData, schedulingFieldsChanged } from '../../utilities/reservationChanges.js'
import { extractId, resolveReservationItems } from '../../utilities/resolveReservationItems.js'
import { isWithinSchedule } from '../../utilities/scheduleWindow.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

const idList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => extractId(v))
    .filter((v) => v !== undefined)
    .map(String)

/** True when the resource lists no services at all, or lists this one. */
export function resourceOffersService(
  resource: null | Record<string, unknown> | undefined,
  serviceId: number | string,
): boolean {
  const offered = idList(resource?.services)
  return offered.length === 0 || offered.includes(String(serviceId))
}

/**
 * Cap on `items[]` for public actors, first in the chain: every item costs
 * several reads, a lock write and a conflict check in the hooks after it, and
 * one anonymous request could carry hundreds.
 */
export const limitPublicItems =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  ({ context, data, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}
    const items = data?.items
    if (!Array.isArray(items) || items.length <= config.maxPublicItems) {return data}
    const publicActor =
      context?.publicBooking === true || (req.user != null && !isPrivilegedUser(req.user, config))
    // An unchanged items[] (a cancel on a larger staff-made booking) passes.
    if (
      !publicActor ||
      !schedulingFieldsChanged({
        data: { items },
        originalDoc: originalDoc as Record<string, unknown> | undefined,
      })
    ) {
      return data
    }
    throw new ValidationError({
      errors: [
        {
          message: `A booking can have at most ${config.maxPublicItems} items`,
          path: 'items',
        },
      ],
    })
  }

/**
 * Policy checks for PUBLIC actors — an anonymous `/reserve/book` or
 * `/reserve/hold` call (the endpoints set `context.publicBooking`) or an
 * authenticated non-staff user, whichever path they take:
 *
 * - no item may start in the past;
 * - with `enforceSchedule` (default on), every item's window must lie inside its
 *   resource's schedule for that business day and not on an exception day —
 *   for a resource that has at least one active schedule; one with none is
 *   unconstrained (see isWithinSchedule).
 *
 * Staff and Local API calls with no user are exempt, so seeds, imports, cron
 * jobs and walk-ins are untouched. Before this hook the write path never looked
 * at schedules at all — the availability endpoints were advisory — which is
 * also what let a customer back-date `startTime` to dodge the cancellation
 * notice period.
 */
export const validateBookingWindow =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    const publicActor =
      context?.publicBooking === true || (req.user != null && !isPrivilegedUser(req.user, config))
    if (!publicActor) {return data}

    const isUpdate = operation === 'update'
    if (
      isUpdate &&
      !schedulingFieldsChanged({
        data: data as Record<string, unknown>,
        originalDoc: originalDoc as Record<string, unknown> | undefined,
      })
    ) {
      return data
    }

    const source = isUpdate
      ? mergeReservationData(
          data as Record<string, unknown>,
          originalDoc as Record<string, unknown> | undefined,
        )
      : (data as Record<string, unknown>)
    if (!source.startTime) {return data}

    const items = resolveReservationItems(source)
    const now = Date.now()
    const serviceCache = new Map<string, null | Record<string, unknown>>()
    const resourceCache = new Map<string, null | Record<string, unknown>>()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const path = item.fromParent || items.length === 1 ? 'startTime' : `items.${i}.startTime`
      const start = new Date(item.startTime)
      if (Number.isNaN(start.getTime())) {continue}

      if (start.getTime() < now) {
        throw new ValidationError({
          errors: [{ message: 'startTime cannot be in the past', path }],
        })
      }

      const endRaw = item.endTime ? new Date(item.endTime) : undefined
      const end = endRaw && !Number.isNaN(endRaw.getTime()) ? endRaw : undefined

      // A top-level resource the caller left out of items[] is occupied for the
      // whole span of the items. Two items a month apart used to block it for
      // that month with a 60-minute service — the unbounded occupancy
      // `maxFlexibleDuration` exists to prevent, reached without `flexible`.
      if (
        item.fromParent &&
        end &&
        end.getTime() - start.getTime() > config.maxFlexibleDuration * 60_000
      ) {
        throw new ValidationError({
          errors: [
            {
              message: `items[] span more than ${config.maxFlexibleDuration} minutes; list the top-level resource in items[] with its own startTime`,
              path: 'items',
            },
          ],
        })
      }

      if (!config.enforceSchedule && !config.enforceServiceMatch) {continue}

      let service: null | Record<string, unknown> | undefined
      if (item.service !== undefined) {
        const key = String(item.service)
        if (!serviceCache.has(key)) {
          serviceCache.set(
            key,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (req.payload.findByID as any)({
              id: item.service,
              collection: config.slugs.services,
              depth: 0,
              disableErrors: true,
              joins: false,
              req,
            }).catch(() => null),
          )
        }
        service = serviceCache.get(key)
      }
      const fullDay = service?.durationType === 'full-day'

      // The resource must offer the service. Nothing checked the pair, so a
      // guest could book any guest-enabled (or shortest, or cheapest) service
      // on any resource. An empty `services` list is unconstrained, and a pool
      // the service itself requires is exempt (pools rarely list the service).
      if (config.enforceServiceMatch && item.service !== undefined) {
        const key = String(item.resource)
        if (!resourceCache.has(key)) {
          resourceCache.set(
            key,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (req.payload.findByID as any)({
              id: item.resource,
              collection: config.slugs.resources,
              depth: 0,
              disableErrors: true,
              joins: false,
              req,
            }).catch(() => null),
          )
        }
        if (
          !resourceOffersService(resourceCache.get(key), item.service) &&
          !idList(service?.requiredResources).includes(key)
        ) {
          throw new ValidationError({
            errors: [
              {
                message: 'This resource does not offer the selected service',
                path: item.fromParent || items.length === 1 ? 'service' : `items.${i}.service`,
              },
            ],
          })
        }
      }

      if (!config.enforceSchedule) {continue}

      const inside = await isWithinSchedule({
        config,
        end,
        fullDay,
        req,
        resourceId: item.resource,
        start,
      })
      if (!inside) {
        throw new ValidationError({
          errors: [{ message: "The requested time is outside the resource's schedule", path }],
        })
      }
    }

    return data
  }

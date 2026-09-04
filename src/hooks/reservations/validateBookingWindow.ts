import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { mergeReservationData, schedulingFieldsChanged } from '../../utilities/reservationChanges.js'
import { resolveReservationItems } from '../../utilities/resolveReservationItems.js'
import { isWithinSchedule } from '../../utilities/scheduleWindow.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

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

      if (!config.enforceSchedule) {continue}

      let fullDay = false
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
        fullDay = serviceCache.get(key)?.durationType === 'full-day'
      }

      const end = item.endTime ? new Date(item.endTime) : undefined
      const inside = await isWithinSchedule({
        config,
        end: end && !Number.isNaN(end.getTime()) ? end : undefined,
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

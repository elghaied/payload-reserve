import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { checkAvailability } from '../../services/AvailabilityService.js'
import {
  mergeReservationData,
  schedulingFieldsChanged,
} from '../../utilities/reservationChanges.js'
import { createReserveDebug } from '../../utilities/reserveDebug.js'
import { extractId, resolveReservationItems } from '../../utilities/resolveReservationItems.js'

export const validateConflicts =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }

    const dbg = createReserveDebug(req.payload.logger, config.debug)

    const isUpdate = operation === 'update'

    // Skip when an update touches no scheduling-relevant field, so reservations
    // booked under older buffers/schedules can still take benign edits.
    if (
      isUpdate &&
      !schedulingFieldsChanged({
        blockingStatuses: config.statusMachine.blockingStatuses,
        data: data as Record<string, unknown>,
        originalDoc: originalDoc as Record<string, unknown> | undefined,
      })
    ) {
      return data
    }

    // Validate the merged document — Payload usually backfills update patches
    // from originalDoc before beforeChange, but the hook must not rely on it.
    const source = isUpdate
      ? mergeReservationData(
          data as Record<string, unknown>,
          originalDoc as Record<string, unknown> | undefined,
        )
      : (data as Record<string, unknown>)

    const items = resolveReservationItems(source)

    if (items.length === 0) {
      return data
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      // An item with no endTime has no window, which makes every check below a
      // no-op: the coarse overlap query filters on endTime and itemsToOccupancies
      // skips it. This used to `continue`, so a booking that could not be bounded
      // was checked against nothing at all. calculateEndTime's chokepoint makes
      // the state unreachable through the collection's own hook chain; a host
      // that reorders or replaces hooks via `collectionOverrides.reservations`
      // can still reach it, and refusing is the only safe answer.
      if (!item.endTime) {
        throw new ValidationError({
          errors: [
            {
              message: 'endTime is required before a reservation can be conflict-checked',
              path: items.length > 1 && !item.fromParent ? `items.${i}.endTime` : 'endTime',
            },
          ],
        })
      }

      // Fetch buffer times from the item's own service (not just the primary)
      const itemServiceId = item.service ?? extractId(source.service)
      let bufferBefore = config.defaultBufferTime
      let bufferAfter = config.defaultBufferTime

      if (itemServiceId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const service = await (req.payload.findByID as any)({
            id: itemServiceId,
            collection: config.slugs.services,
            depth: 0,
            // Skip the resources join — internal logic never reads it, and without this
            // every service read becomes an aggregation with a $lookup.
            joins: false,
            req,
          })
          if (service) {
            bufferBefore = (service.bufferTimeBefore as number) ?? config.defaultBufferTime
            bufferAfter = (service.bufferTimeAfter as number) ?? config.defaultBufferTime
          }
        } catch {
          // Use defaults if service lookup fails
        }
      }

      // Other items of this same booking on the same resource count as occupancy
      // so two items can't double-book one resource within one create (review A5).
      const siblingItems = items.filter((other, j) => j !== i && other.resource === item.resource)

      const result = await checkAvailability({
        blockingStatuses: config.statusMachine.blockingStatuses,
        bufferAfter,
        bufferBefore,
        debug: dbg,
        endTime: new Date(item.endTime),
        excludeHoldToken:
          typeof context?.holdToken === 'string' ? context.holdToken : undefined,
        excludeReservationId: isUpdate ? originalDoc?.id : undefined,
        getExternalBusy: config.getExternalBusy,
        guestCount: item.guestCount,
        holdsSlug: config.slotHolds.enabled ? config.slugs.holds : undefined,
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceId: item.resource,
        resourceSlug: config.slugs.resources,
        servicesSlug: config.slugs.services,
        siblingItems,
        startTime: new Date(item.startTime),
      })

      dbg.dbg('conflict_check', {
        available: result.available,
        index: i,
        resourceId: item.resource,
        startTime: new Date(item.startTime).toISOString(),
      })

      if (!result.available) {
        dbg.dbg('conflict_reject', {
          index: i,
          reason: result.reason,
          resourceId: item.resource,
          startTime: new Date(item.startTime).toISOString(),
        })

        throw new ValidationError({
          errors: [
            {
              message: result.reason ?? (req.t as PluginT)('reservation:errorConflict'),
              path: items.length > 1 && !item.fromParent ? `items.${i}.startTime` : 'startTime',
            },
          ],
        })
      }
    }

    return data
  }

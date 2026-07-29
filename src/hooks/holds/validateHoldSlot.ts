import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { checkAvailability } from '../../services/AvailabilityService.js'
import { extractId } from '../../utilities/resolveReservationItems.js'

/**
 * Serialize and validate a slot hold, inside the hold's own transaction.
 *
 * This deliberately lives in a `beforeChange` hook rather than in a service
 * function that calls the pieces in sequence. The lock only serializes anything
 * if the lock write, the availability read, and the insert all share one
 * transaction — and Payload opens that transaction around `create`, so a hook
 * is inside it while an orchestrating caller is not. An earlier version of this
 * ran the same three steps from a service function and granted 3 of 8
 * simultaneous holds for one slot; moved here, it grants exactly 1.
 */
export const validateHoldSlot =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks || operation !== 'create') {
      return data
    }

    const resourceId = extractId(data.resource)
    const serviceId = extractId(data.service)

    if (resourceId === undefined || !data.startTime || !data.endTime) {
      return data
    }

    // Claim the resource first. Two simultaneous holds — or a hold racing a
    // booking — now collide on this one document and the database serializes
    // them. See acquireBookingLock for the full rationale.
    await req.payload.db.updateOne({
      id: resourceId,
      collection: config.slugs.resources,
      data: { bookingLock: `hold:${String(data.startTime)}` },
      req,
      returning: false,
    })

    let bufferBefore = config.defaultBufferTime
    let bufferAfter = config.defaultBufferTime

    if (serviceId !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = await (req.payload.findByID as any)({
        id: serviceId,
        collection: config.slugs.services,
        depth: 0,
        joins: false,
        req,
      })

      if (service) {
        if (config.enforceActive && service.active === false) {
          throw new ValidationError({
            errors: [{ message: 'Service is not active', path: 'service' }],
          })
        }
        bufferBefore = (service.bufferTimeBefore as number) ?? config.defaultBufferTime
        bufferAfter = (service.bufferTimeAfter as number) ?? config.defaultBufferTime
      }
    }

    const availability = await checkAvailability({
      blockingStatuses: config.statusMachine.blockingStatuses,
      bufferAfter,
      bufferBefore,
      endTime: new Date(data.endTime as string),
      getExternalBusy: config.getExternalBusy,
      guestCount: (data.guestCount as number) ?? 1,
      holdsSlug: config.slugs.holds,
      payload: req.payload,
      req,
      reservationSlug: config.slugs.reservations,
      resourceId,
      resourceSlug: config.slugs.resources,
      servicesSlug: config.slugs.services,
      startTime: new Date(data.startTime as string),
    })

    if (!availability.available) {
      throw new ValidationError({
        errors: [
          { message: availability.reason ?? 'Slot is not available', path: 'startTime' },
        ],
      })
    }

    return data
  }

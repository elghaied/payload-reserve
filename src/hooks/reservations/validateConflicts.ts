import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { checkAvailability } from '../../services/AvailabilityService.js'
import { resolveReservationItems } from '../../utilities/resolveReservationItems.js'

export const validateConflicts =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    const items = resolveReservationItems(data as Record<string, unknown>)

    if (items.length === 0) {return data}

    // Fetch buffer times from the primary service
    const serviceId = typeof data?.service === 'object' ? data.service.id : data?.service
    let bufferBefore = config.defaultBufferTime
    let bufferAfter = config.defaultBufferTime

    if (serviceId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (req.payload.findByID as any)({
          id: serviceId,
          collection: config.slugs.services,
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

    for (const item of items) {
      if (!item.endTime) {continue}

      const result = await checkAvailability({
        blockingStatuses: config.statusMachine.blockingStatuses,
        bufferAfter,
        bufferBefore,
        endTime: new Date(item.endTime),
        excludeReservationId: operation === 'update' ? originalDoc?.id : undefined,
        guestCount: item.guestCount,
        payload: req.payload,
        req,
        reservationSlug: config.slugs.reservations,
        resourceId: item.resource,
        resourceSlug: config.slugs.resources,
        startTime: new Date(item.startTime),
      })

      if (!result.available) {
        throw new ValidationError({
          errors: [
            {
              message: result.reason ?? (req.t as PluginT)('reservation:errorConflict'),
              path: 'startTime',
            },
          ],
        })
      }
    }

    return data
  }

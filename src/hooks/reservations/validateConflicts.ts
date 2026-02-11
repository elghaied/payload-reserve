import type { CollectionBeforeChangeHook, Where } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { computeBlockedWindow } from '../../utilities/slotUtils.js'

export const validateConflicts =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    if (!data?.startTime || !data?.endTime || !data?.resource) {return data}

    const serviceId = typeof data.service === 'object' ? data.service.id : data.service

    let bufferBefore = config.defaultBufferTime
    let bufferAfter = config.defaultBufferTime

    if (serviceId) {
      try {
        const service = await req.payload.findByID({
          id: serviceId,
          collection: config.slugs.services as 'reservation-services',
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

    const startTime = new Date(data.startTime)
    const endTime = new Date(data.endTime)
    const { effectiveEnd, effectiveStart } = computeBlockedWindow(
      startTime,
      endTime,
      bufferBefore,
      bufferAfter,
    )

    const resourceId = typeof data.resource === 'object' ? data.resource.id : data.resource

    const where: Where = {
      and: [
        { resource: { equals: resourceId } },
        {
          status: {
            not_in: ['cancelled', 'no-show'],
          },
        },
        { startTime: { less_than: effectiveEnd.toISOString() } },
        { endTime: { greater_than: effectiveStart.toISOString() } },
      ],
    }

    // Exclude self on update
    if (operation === 'update' && originalDoc?.id) {
      ;(where.and as Where[]).push({ id: { not_equals: originalDoc.id } })
    }

    const { totalDocs } = await req.payload.count({
      collection: config.slugs.reservations as 'reservations',
      req,
      where,
    })

    if (totalDocs > 0) {
      throw new ValidationError({
        errors: [
          {
            message: 'This time slot conflicts with an existing reservation for this resource.',
            path: 'startTime',
          },
        ],
      })
    }

    return data
  }

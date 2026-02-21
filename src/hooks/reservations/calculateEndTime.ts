import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { DurationType, ResolvedReservationPluginConfig } from '../../types.js'

import { computeEndTime } from '../../services/AvailabilityService.js'
import { resolveReservationItems } from '../../utilities/resolveReservationItems.js'

export const calculateEndTime =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, req }) => {
    if (context?.skipReservationHooks) {return data}

    if (!data?.startTime || !data?.service) {return data}

    const items = resolveReservationItems(data)

    if (items.length <= 1) {
      // Single-resource: compute top-level endTime
      const serviceId = typeof data.service === 'object' ? data.service.id : data.service

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = await (req.payload.findByID as any)({
        id: serviceId,
        collection: config.slugs.services,
        req,
      })

      if (!service?.duration && service?.durationType !== 'full-day') {return data}

      const durationType = ((service.durationType as string) ?? 'fixed') as DurationType
      const startDate = new Date(data.startTime)

      if (durationType === 'flexible') {
        if (!data.endTime) {
          throw new ValidationError({
            errors: [{ message: 'endTime is required for flexible duration services', path: 'endTime' }],
          })
        }
        // Validate customer-provided endTime (computeEndTime returns it back)
        computeEndTime({
          durationType: 'flexible',
          endTime: new Date(data.endTime),
          serviceDuration: service.duration as number,
          startTime: startDate,
        })
      } else {
        const result = computeEndTime({
          durationType,
          serviceDuration: (service.duration as number) ?? 0,
          startTime: startDate,
        })
        data.endTime = result.endTime.toISOString()
      }
    } else {
      // Multi-resource: compute endTime per item
      for (const item of data.items as Array<Record<string, unknown>>) {
        if (!item.startTime) {continue}

        const itemServiceId = typeof item.service === 'object'
          ? (item.service as { id: string }).id
          : (item.service as string) ?? (typeof data.service === 'object' ? data.service.id : data.service)

        if (!itemServiceId) {continue}

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (req.payload.findByID as any)({
          id: itemServiceId,
          collection: config.slugs.services,
          req,
        })

        if (!service?.duration && service?.durationType !== 'full-day') {continue}

        const durationType = ((service.durationType as string) ?? 'fixed') as DurationType

        if (durationType === 'flexible' && !item.endTime) {continue}

        if (durationType !== 'flexible') {
          const result = computeEndTime({
            durationType,
            serviceDuration: (service.duration as number) ?? 0,
            startTime: new Date(item.startTime as string),
          })
          item.endTime = result.endTime.toISOString()
        }
      }
    }

    return data
  }

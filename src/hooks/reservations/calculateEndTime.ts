import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { DurationType, ResolvedReservationPluginConfig } from '../../types.js'

import { computeEndTime } from '../../services/AvailabilityService.js'
import {
  mergeReservationData,
  schedulingFieldsChanged,
} from '../../utilities/reservationChanges.js'
import { extractId, resolveReservationItems } from '../../utilities/resolveReservationItems.js'

export const calculateEndTime =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }

    const isUpdate = operation === 'update'

    // Skip when an update touches no scheduling-relevant field — a notes or
    // status edit must not recompute (or invalidate) the stored times.
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

    // On update `data` is a partial patch — compute from the merged document.
    const merged = isUpdate
      ? mergeReservationData(
          data as Record<string, unknown>,
          originalDoc as Record<string, unknown> | undefined,
        )
      : (data as Record<string, unknown>)

    if (!merged?.startTime || !merged?.service) {
      return data
    }

    const items = resolveReservationItems(merged)

    if (items.length <= 1) {
      // Single-resource: compute top-level endTime
      const serviceId = extractId(merged.service)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = await (req.payload.findByID as any)({
        id: serviceId,
        collection: config.slugs.services,
        req,
      })

      if (!service?.duration && service?.durationType !== 'full-day') {
        return data
      }

      const durationType = ((service.durationType as string) ?? 'fixed') as DurationType
      const startDate = new Date(merged.startTime as string)

      if (durationType === 'flexible') {
        if (!merged.endTime) {
          throw new ValidationError({
            errors: [
              { message: 'endTime is required for flexible duration services', path: 'endTime' },
            ],
          })
        }
        // Validate customer-provided endTime (computeEndTime returns it back)
        computeEndTime({
          durationType: 'flexible',
          endTime: new Date(merged.endTime as string),
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
      // Multi-resource: only recompute when the patch itself carries items[].
      // Rewriting originalDoc's items from a partial patch is multi-item span
      // territory (review A4) and out of scope here.
      if (isUpdate && !data.items) {
        return data
      }

      // Compute endTime per item, then set a top-level endTime that spans all
      // items so conflict detection (which queries top-level startTime/endTime)
      // can see this reservation.
      let earliestStart: Date | undefined
      let latestEnd: Date | undefined
      for (const item of data.items as Array<Record<string, unknown>>) {
        if (!item.startTime) {
          continue
        }

        const itemServiceId = extractId(item.service) ?? extractId(merged.service)

        if (!itemServiceId) {
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (req.payload.findByID as any)({
          id: itemServiceId,
          collection: config.slugs.services,
          req,
        })

        if (!service?.duration && service?.durationType !== 'full-day') {
          continue
        }

        const durationType = ((service.durationType as string) ?? 'fixed') as DurationType

        if (durationType === 'flexible' && !item.endTime) {
          continue
        }

        if (durationType !== 'flexible') {
          const result = computeEndTime({
            durationType,
            serviceDuration: (service.duration as number) ?? 0,
            startTime: new Date(item.startTime as string),
          })
          item.endTime = result.endTime.toISOString()
        }

        const start = new Date(item.startTime as string)
        if (!earliestStart || start < earliestStart) {
          earliestStart = start
        }

        if (item.endTime) {
          const end = new Date(item.endTime as string)
          if (!latestEnd || end > latestEnd) {
            latestEnd = end
          }
        }
      }

      if (earliestStart) {
        data.startTime = earliestStart.toISOString()
      }

      if (latestEnd) {
        data.endTime = latestEnd.toISOString()
      }
    }

    return data
  }

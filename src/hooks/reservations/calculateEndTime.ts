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

    // Branch on REAL items only. A synthesised parent item (B1) must not flip a
    // single-resource booking onto the multi-resource path — that would change
    // which code computes endTime, which this fix deliberately does not touch.
    const realItemCount = items.filter((i) => !i.fromParent).length

    if (realItemCount <= 1) {
      // Single-resource: compute top-level endTime
      const serviceId = extractId(merged.service)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = await (req.payload.findByID as any)({
        id: serviceId,
        collection: config.slugs.services,
        depth: 0,
        // Skip the resources join — internal logic never reads it, and without this
        // every service read becomes an aggregation with a $lookup.
        joins: false,
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
        // An inverted window would be invisible to overlap queries — reject it
        // (computeEndTime performs no validation for flexible durations).
        if (new Date(merged.endTime as string) <= startDate) {
          throw new ValidationError({
            errors: [{ message: 'endTime must be after startTime', path: 'endTime' }],
          })
        }
      } else {
        const result = computeEndTime({
          durationType,
          serviceDuration: (service.duration as number) ?? 0,
          startTime: startDate,
          timeZone: config.timezone,
        })
        data.endTime = result.endTime.toISOString()
      }
    } else {
      // Multi-resource: recompute only when the patch carries items[]. In
      // practice Payload backfills items from originalDoc on API updates, so
      // this guard mainly protects direct programmatic invocation; the
      // schedulingFieldsChanged gate above is the real skip for benign edits.
      // Rewriting items from a partial patch is A4 territory and out of scope.
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
          depth: 0,
          // Skip the resources join — internal logic never reads it, and without this
          // every service read becomes an aggregation with a $lookup.
          joins: false,
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
            timeZone: config.timezone,
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

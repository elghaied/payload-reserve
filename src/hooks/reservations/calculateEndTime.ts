import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { DurationType, ResolvedReservationPluginConfig } from '../../types.js'

import { computeEndTime } from '../../services/AvailabilityService.js'
import { flexibleWindowProblem } from '../../utilities/flexibleWindow.js'
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
        // An inverted window would be invisible to overlap queries; an
        // unbounded one blocks the resource forever; one shorter than the
        // service duration breaks the documented minimum.
        const problem = flexibleWindowProblem({
          config,
          end: new Date(merged.endTime as string),
          service,
          start: startDate,
        })
        if (problem) {
          throw new ValidationError({ errors: [{ message: problem, path: 'endTime' }] })
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

      // A single real items[] entry used to get no endTime of its own: this
      // branch only bounded the top-level window, and resolveReservationItems
      // then backfilled the item from it — so a 60-minute item service on a
      // second resource occupied that resource for the parent's 30 minutes, on
      // both the write and the read path. Materialise the item's true window
      // and widen the top-level end to cover it.
      if (realItemCount === 1 && Array.isArray(data.items) && data.items.length === 1) {
        const item = data.items[0] as Record<string, unknown>
        const itemStartRaw =
          (item.startTime as string | undefined) ?? (merged.startTime as string | undefined)
        const itemServiceId = extractId(item.service) ?? serviceId
        if (itemStartRaw && itemServiceId !== undefined) {
          const itemService =
            String(itemServiceId) === String(serviceId)
              ? service
              : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (req.payload.findByID as any)({
                  id: itemServiceId,
                  collection: config.slugs.services,
                  depth: 0,
                  disableErrors: true,
                  joins: false,
                  req,
                }).catch(() => null)
          const itemStart = new Date(itemStartRaw)
          if (itemService && (itemService.duration || itemService.durationType === 'full-day')) {
            const itemType = ((itemService.durationType as string) ?? 'fixed') as DurationType
            if (itemType === 'flexible') {
              const inherited =
                (item.endTime as string | undefined) ??
                (data.endTime as string | undefined) ??
                (merged.endTime as string | undefined)
              if (!inherited) {
                throw new ValidationError({
                  errors: [
                    {
                      message: 'endTime is required for flexible duration services',
                      path: 'items.0.endTime',
                    },
                  ],
                })
              }
              const problem = flexibleWindowProblem({
                config,
                end: new Date(inherited),
                service: itemService,
                start: itemStart,
              })
              if (problem) {
                throw new ValidationError({
                  errors: [{ message: problem, path: 'items.0.endTime' }],
                })
              }
              item.endTime = inherited
            } else {
              item.endTime = computeEndTime({
                durationType: itemType,
                serviceDuration: (itemService.duration as number) ?? 0,
                startTime: itemStart,
                timeZone: config.timezone,
              }).endTime.toISOString()
            }
            const topEnd =
              (data.endTime as string | undefined) ?? (merged.endTime as string | undefined)
            if (!topEnd || new Date(item.endTime as string) > new Date(topEnd)) {
              data.endTime = item.endTime
            }
          }
        }
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
      const dataItems = data.items as Array<Record<string, unknown>>
      for (let i = 0; i < dataItems.length; i++) {
        const item = dataItems[i]
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

        if (durationType === 'flexible') {
          // Inherit the top-level endTime the way resolveReservationItems does,
          // so a requiredResources pool expanded into items[] is bounded by the
          // window the caller actually stated. Skipping instead (the old
          // behaviour) left `latestEnd` underived, so the row was stored with a
          // NULL top-level endTime that no downstream guard can see — while the
          // single-resource branch refused the very same input. Both branches
          // must refuse it alike; a booking's end is never guessed.
          const inherited =
            (item.endTime as string | undefined) ?? (merged.endTime as string | undefined)

          if (!inherited) {
            throw new ValidationError({
              errors: [
                { message: 'endTime is required for flexible duration services', path: 'endTime' },
              ],
            })
          }

          // Inverted, unbounded, or shorter than the service minimum — the
          // same rule the single-resource branch applies.
          const problem = flexibleWindowProblem({
            config,
            end: new Date(inherited),
            service,
            start: new Date(item.startTime as string),
          })
          if (problem) {
            throw new ValidationError({
              errors: [{ message: problem, path: `items.${i}.endTime` }],
            })
          }

          // Materialise it: a stored item with no endTime contributes no
          // occupancy of its own resource.
          item.endTime = inherited
        } else {
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

    // One chokepoint for both branches: an unbounded reservation is an
    // UNCHECKED reservation. Conflict detection, occupancy and availability all
    // skip a row with no endTime — buildCoarseOverlapQuery filters on
    // `endTime greater_than`, so such a row is invisible to every other
    // booking's check, and resolveReservationItems can only backfill an item's
    // endTime from a top-level one that exists. Any `continue` above that
    // leaves the span underived (an item with no startTime, an unresolvable
    // service) lands here instead of silently storing a NULL.
    //
    // Its scope, so it is not over-trusted: this catches every path that
    // REACHES the end of this hook. It is NOT a guarantee that every stored
    // reservation carries an endTime, because the early `return data`s above
    // bypass it deliberately — an update touching no scheduling field, a doc
    // with no startTime/service, a multi-resource update whose patch carries no
    // items[], and (only if a consumer relaxes the required `duration` field
    // via collectionOverrides) a service with no duration that is not
    // full-day. The first of those is load-bearing: it is what keeps a row
    // ALREADY stored with a NULL endTime editable and cancellable rather than
    // trapping it, while any edit that actually reschedules one still lands
    // here and must bound it.
    const effectiveEnd =
      (data.endTime as string | undefined) ?? (merged.endTime as string | undefined)

    if (!effectiveEnd) {
      throw new ValidationError({
        errors: [
          { message: 'endTime could not be determined for this reservation', path: 'endTime' },
        ],
      })
    }

    return data
  }

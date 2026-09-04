import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { mergeReservationData } from '../../utilities/reservationChanges.js'
import { extractId } from '../../utilities/resolveRequiredResources.js'

const toMs = (value: unknown): null | number => {
  if (value === null || value === undefined || value === '') {return null}
  const ms = new Date(value as string).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Expand a service's `requiredResources` into the reservation's `items[]` so the
 * booking actually occupies every required resource pool. Runs before
 * calculateEndTime and validateConflicts so the appended items get endTimes and
 * are conflict-checked.
 *
 * A required pool counts as already present only when an existing item names it
 * for the SAME window as the parent booking — an exact start match, or an
 * overlap when both ends are known. Keying on the resource id alone (the old
 * rule) let a caller list the pool at an unrelated time and suppress the
 * expansion, leaving the pool free at the real time. `resolveReservationItems`
 * applies the same rule for the synthesised parent item.
 *
 * Also runs on update when the service changes: a booking moved onto a service
 * with required pools used to keep only its primary resource.
 */
export const expandRequiredResources =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}
    if (operation !== 'create' && operation !== 'update') {return data}

    const merged =
      operation === 'update'
        ? mergeReservationData(
            data as Record<string, unknown>,
            originalDoc as Record<string, unknown> | undefined,
          )
        : (data as Record<string, unknown>)

    const serviceId = extractId(merged.service)
    if (!serviceId || !merged.startTime) {return data}

    if (operation === 'update') {
      const previousService = extractId(originalDoc?.service)
      if (previousService !== undefined && String(previousService) === String(serviceId)) {
        return data
      }
    }

    let required: Array<number | string> = []
    try {
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
      required = ((service?.requiredResources as unknown[]) ?? [])
        .map((r) => extractId(r))
        .filter((r): r is number | string => r !== undefined)
    } catch {
      return data
    }

    if (required.length === 0) {return data}

    const parentStart = toMs(merged.startTime)
    const parentEnd = toMs(merged.endTime)
    const coversParentWindow = (it: Record<string, unknown>): boolean => {
      const itemStart = toMs(it.startTime) ?? parentStart
      if (itemStart === null || parentStart === null) {return true}
      if (itemStart === parentStart) {return true}
      const itemEnd = toMs(it.endTime) ?? parentEnd
      if (itemEnd === null || parentEnd === null) {return false}
      return itemStart < parentEnd && parentStart < itemEnd
    }

    const existingItems = Array.isArray(merged.items)
      ? [...(merged.items as Array<Record<string, unknown>>)]
      : []
    const present = new Set<string>()
    if (existingItems.length > 0) {
      for (const it of existingItems) {
        const r = extractId(it.resource)
        if (r !== undefined && coversParentWindow(it)) {present.add(String(r))}
      }
    }
    const primary = extractId(merged.resource)
    if (primary !== undefined) {present.add(String(primary))}

    const additions = required.filter((r) => !present.has(String(r)))
    if (additions.length === 0) {return data}

    const items: Array<Record<string, unknown>> = [...existingItems]
    if (existingItems.length === 0 && primary !== undefined) {
      items.push({
        endTime: merged.endTime,
        resource: primary,
        service: serviceId,
        startTime: merged.startTime,
      })
    }

    for (const r of additions) {
      items.push({
        endTime: merged.endTime,
        resource: r,
        service: serviceId,
        startTime: merged.startTime,
      })
    }

    data.items = items
    return data
  }

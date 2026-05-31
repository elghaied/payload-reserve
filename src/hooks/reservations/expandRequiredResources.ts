import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { extractId } from '../../utilities/resolveRequiredResources.js'

/**
 * Expand a service's `requiredResources` into the reservation's `items[]` so the
 * booking actually occupies every required resource pool. Runs before
 * calculateEndTime and validateConflicts so the appended items get endTimes and
 * are conflict-checked.
 */
export const expandRequiredResources =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, req }) => {
    if (context?.skipReservationHooks) {return data}

    const serviceId = extractId(data?.service)
    if (!serviceId || !data?.startTime) {return data}

    let required: Array<number | string> = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = await (req.payload.findByID as any)({
        id: serviceId,
        collection: config.slugs.services,
        depth: 0,
        req,
      })
      required = ((service?.requiredResources as unknown[]) ?? [])
        .map((r) => extractId(r))
        .filter((r): r is number | string => r !== undefined)
    } catch {
      return data
    }

    if (required.length === 0) {return data}

    const existingItems = Array.isArray(data.items)
      ? [...(data.items as Array<Record<string, unknown>>)]
      : []
    const present = new Set<string>()
    if (existingItems.length > 0) {
      for (const it of existingItems) {
        const r = extractId(it.resource)
        if (r !== undefined) {present.add(String(r))}
      }
    } else {
      const primary = extractId(data.resource)
      if (primary !== undefined) {present.add(String(primary))}
    }

    const additions = required.filter((r) => !present.has(String(r)))
    if (additions.length === 0) {return data}

    const items: Array<Record<string, unknown>> = [...existingItems]
    if (existingItems.length === 0) {
      const primary = extractId(data.resource)
      if (primary !== undefined) {
        items.push({
          endTime: data.endTime,
          resource: primary,
          service: serviceId,
          startTime: data.startTime,
        })
      }
    }

    for (const r of additions) {
      items.push({
        endTime: data.endTime,
        resource: r,
        service: serviceId,
        startTime: data.startTime,
      })
    }

    data.items = items
    return data
  }

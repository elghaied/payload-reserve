import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { mergeReservationData } from '../../utilities/reservationChanges.js'
import { extractId, resolveReservationItems } from '../../utilities/resolveReservationItems.js'

/**
 * Rejects bookings against an inactive service or resource.
 *
 * MUST run AFTER expandRequiredResources — that hook injects a service's
 * requiredResources into items[] with no active check of its own, so running
 * earlier would let an inactive pool through. MUST run BEFORE validateConflicts
 * so a cheap rejection precedes the expensive coarse-overlap queries.
 */
export const validateActive =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks || !config.enforceActive) {
      return data
    }

    // Validate the merged document — Payload usually backfills update patches
    // from originalDoc before beforeChange, but the hook must not rely on it.
    const merged = mergeReservationData(
      data as Record<string, unknown>,
      originalDoc as Record<string, unknown> | undefined,
    )
    const items = resolveReservationItems(merged)

    // On update, only re-check references that actually changed. Otherwise a
    // service deactivated after booking would make its existing reservations
    // permanently uneditable.
    const previous =
      operation === 'update'
        ? resolveReservationItems((originalDoc ?? {}) as Record<string, unknown>)
        : []
    const previousKeys = new Set(
      previous.map((p) => `${String(extractId(p.service))}|${String(extractId(p.resource))}`),
    )

    for (const [index, item] of items.entries()) {
      const serviceId = extractId(item.service)
      const resourceId = extractId(item.resource)

      if (
        operation === 'update' &&
        previousKeys.has(`${String(serviceId)}|${String(resourceId)}`)
      ) {
        continue
      }

      const prefix = items.length > 1 ? `items.${index}.` : ''

      for (const [kind, id, slug, key] of [
        ['service', serviceId, config.slugs.services, 'errorServiceInactive'],
        ['resource', resourceId, config.slugs.resources, 'errorResourceInactive'],
      ] as const) {
        if (id === undefined) {
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = await (req.payload.findByID as any)({
          id,
          collection: slug,
          depth: 0,
          // Skip joins — internal logic never reads them, and without this
          // every read becomes an aggregation with a $lookup.
          joins: false,
          req,
        }).catch(() => null)

        if (doc && doc.active === false) {
          throw new ValidationError({
            errors: [
              {
                message: (req.t as PluginT)(`reservation:${key}`, {
                  name: (doc.name as string) ?? String(id),
                }),
                path: `${prefix}${kind}`,
              },
            ],
          })
        }
      }
    }

    return data
  }

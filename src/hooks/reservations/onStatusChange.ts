import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

export const onStatusChange =
  (config: ResolvedReservationPluginConfig): CollectionAfterChangeHook =>
  async ({ context, doc, operation, previousDoc, req }) => {
    if (context?.skipReservationHooks) {return doc}
    // On create Payload passes previousDoc: {} (not undefined) — there is no
    // previous status, so status-change hooks must not fire (afterBookingCreate
    // covers creation).
    if (operation !== 'update') {return doc}
    if (!previousDoc?.status || previousDoc.status === doc.status) {return doc}

    const prev = previousDoc.status as string
    const next = doc.status as string

    if (config.hooks?.afterStatusChange) {
      for (const hook of config.hooks.afterStatusChange) {
        try {
          await hook({ doc: doc as Record<string, unknown>, newStatus: next, previousStatus: prev, req })
        } catch (err) {
          req.payload.logger.error({ err, msg: `afterStatusChange hook failed for reservation ${doc.id}` })
        }
      }
    }

    if (next === 'confirmed' && config.hooks?.afterBookingConfirm) {
      for (const hook of config.hooks.afterBookingConfirm) {
        try {
          await hook({ doc: doc as Record<string, unknown>, req })
        } catch (err) {
          req.payload.logger.error({ err, msg: `afterBookingConfirm hook failed for reservation ${doc.id}` })
        }
      }
    }
    if (next === 'cancelled' && config.hooks?.afterBookingCancel) {
      for (const hook of config.hooks.afterBookingCancel) {
        try {
          await hook({ doc: doc as Record<string, unknown>, req })
        } catch (err) {
          req.payload.logger.error({ err, msg: `afterBookingCancel hook failed for reservation ${doc.id}` })
        }
      }
    }

    return doc
  }

import type { CollectionAfterChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

export const onStatusChange =
  (config: ResolvedReservationPluginConfig): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req }) => {
    if (!previousDoc || previousDoc.status === doc.status) {return doc}

    const prev = previousDoc.status as string
    const next = doc.status as string

    // Call generic afterStatusChange plugin hooks
    if (config.hooks?.afterStatusChange) {
      for (const hook of config.hooks.afterStatusChange) {
        await hook({ doc: doc as Record<string, unknown>, newStatus: next, previousStatus: prev, req })
      }
    }

    // Call specific hooks based on transition
    if (next === 'confirmed' && config.hooks?.afterBookingConfirm) {
      for (const hook of config.hooks.afterBookingConfirm) {
        await hook({ doc: doc as Record<string, unknown>, req })
      }
    }
    if (next === 'cancelled' && config.hooks?.afterBookingCancel) {
      for (const hook of config.hooks.afterBookingCancel) {
        await hook({ doc: doc as Record<string, unknown>, req })
      }
    }

    return doc
  }

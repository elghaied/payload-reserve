import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import {
  mergeReservationData,
  schedulingFieldsChanged,
} from '../../utilities/reservationChanges.js'
import { resolveReservationItems } from '../../utilities/resolveReservationItems.js'

/**
 * Serialize concurrent bookings that claim the same resource.
 *
 * `validateConflicts` is a read-then-write: it queries for overlapping
 * reservations, then Payload inserts. Payload runs `create` inside a
 * transaction, but transactional isolation does not help here — snapshot
 * isolation lets N transactions each read "no conflict" and then insert N
 * DIFFERENT documents. A database raises a write conflict only when two
 * transactions touch the SAME document, and reservation rows are distinct.
 * Measured: 10 simultaneous bookings for one `quantity: 1` slot produced 10
 * confirmed reservations.
 *
 * This hook manufactures the missing contention. Before the conflict check
 * reads, it writes a throwaway value to each claimed resource's `bookingLock`
 * field on the booking's own transaction. Two bookings for one resource now
 * collide on that single document, and the database serializes them:
 *
 * - MongoDB fails the loser fast with a WriteConflict; its transaction aborts
 *   and nothing is inserted.
 * - Postgres/SQLite block the loser until the winner commits, then let it
 *   proceed — where `validateConflicts` now SEES the committed booking and
 *   rejects it through the normal path.
 *
 * Either way the outcome is correct. The write goes through the database
 * adapter rather than the Local API deliberately: this must not fire Resources
 * hooks, run its access control, or touch its version history.
 */
export const acquireBookingLock =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }

    // Mirror validateConflicts' guard exactly. A benign edit claims no resource
    // time, so it needs no lock — and taking one would resolve items on a row
    // whose items[] may hold a duplicate (resource, startTime) pair that
    // resolveReservationItems rejects, breaking edits that must stay possible.
    const isUpdate = operation === 'update'
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

    const source =
      isUpdate
        ? mergeReservationData(
            data as Record<string, unknown>,
            originalDoc as Record<string, unknown> | undefined,
          )
        : (data as Record<string, unknown>)

    const items = resolveReservationItems(source)
    if (items.length === 0) {
      return data
    }

    // Sorted so two bookings claiming the same pair of resources always take
    // them in the same order — otherwise A(r1,r2) and B(r2,r1) could deadlock
    // on a blocking database.
    const resourceIds = [...new Set(items.map((item) => String(item.resource)))].sort()

    const token = `${Date.now()}:${resourceIds.length}`

    for (const id of resourceIds) {
      await req.payload.db.updateOne({
        id,
        collection: config.slugs.resources,
        data: { bookingLock: token },
        req,
        returning: false,
      })
    }

    return data
  }

import type { CollectionBeforeDeleteHook } from 'payload'

import { APIError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

/**
 * Refuse to delete a Service or Resource that reservations still point at.
 *
 * Without this the two databases disagree, and neither behaviour was designed.
 * `service` and `resource` are required on Reservations, so Postgres makes those
 * columns NOT NULL while the drizzle adapter emits ON DELETE SET NULL — the
 * delete fails with a raw 23502 that means nothing to the person clicking the
 * button. Mongo has no such constraint, so the same delete succeeds and leaves
 * reservations pointing at a document that no longer exists.
 *
 * The plugin already ships `active` for retiring something without destroying
 * booking history, which is what the error points people at.
 */
export function preventDeleteWhenReferenced({
  config,
  field,
  label,
}: {
  config: ResolvedReservationPluginConfig
  field: 'resource' | 'service'
  label: string
}): CollectionBeforeDeleteHook {
  return async ({ id, context, req }) => {
    if (context?.skipReservationHooks) {return}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { totalDocs } = await (req.payload.count as any)({
      collection: config.slugs.reservations,
      req,
      where: {
        or: [{ [field]: { equals: id } }, { [`items.${field}`]: { equals: id } }],
      },
    })

    if (totalDocs > 0) {
      throw new APIError(
        `Cannot delete this ${label}: ${totalDocs} reservation${totalDocs === 1 ? '' : 's'} still reference${totalDocs === 1 ? 's' : ''} it. Uncheck "active" to retire it instead — that stops new bookings while keeping existing ones intact.`,
        400,
      )
    }
  }
}

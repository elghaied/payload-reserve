import type { CollectionBeforeDeleteHook } from 'payload'

import { APIError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

/**
 * Refuse to delete a Service or Resource that other documents still point at.
 *
 * Without this the two databases disagree, and neither behaviour was designed.
 * The referencing fields (Reservations.service/resource, Schedules.resource)
 * are `required: true`, so Postgres and SQLite make those columns NOT NULL
 * while the drizzle adapter emits ON DELETE SET NULL for both — the delete
 * fails with a raw 23502/SQLITE_CONSTRAINT_NOTNULL that means nothing to the
 * person clicking the button. Mongo has no such constraint, so the same
 * delete succeeds and leaves the referencing document pointing at nothing.
 *
 * The plugin already ships `active` for retiring something without destroying
 * booking (or schedule) history, which is what the error points people at.
 *
 * `extraChecks` lets a caller add more referencing collections beyond
 * Reservations — e.g. Resources is also referenced by Schedules.resource,
 * which has no items[]-style nesting so a plain field-equals check suffices.
 * Every check is a single `count` query (one query per related collection),
 * never one query per referencing document.
 *
 * The counts run SEQUENTIALLY, and that is load-bearing rather than an
 * oversight. This hook runs inside the transaction `deleteByID` opened, on the
 * caller's `req`, and a MongoDB ClientSession cannot carry concurrent operations
 * inside a transaction. Running these as a `Promise.all` made two `count`s share
 * one session: the loser's `count` calls `killTransaction` from its own catch,
 * which rolls back and clears the transaction the DELETE owns, and the delete
 * then fails with `NoSuchTransaction` ("transaction number N does not match any
 * in-progress transactions") instead of this hook's actionable 400. Two count
 * queries do not need parallelism.
 */
export function preventDeleteWhenReferenced({
  config,
  extraChecks = [],
  field,
  label,
}: {
  config: ResolvedReservationPluginConfig
  extraChecks?: Array<{
    collection: string
    /** Rows whose value here is in the past are swept before counting (slot holds). */
    expiresField?: string
    field: string
    label: string
  }>
  field: 'resource' | 'service'
  label: string
}): CollectionBeforeDeleteHook {
  return async ({ id, context, req }) => {
    if (context?.skipReservationHooks) {return}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countFn = req.payload.count as any

    const reservations = (await countFn({
      collection: config.slugs.reservations,
      req,
      where: {
        or: [{ [field]: { equals: id } }, { [`items.${field}`]: { equals: id } }],
      },
    })) as { totalDocs: number }

    const extras: Array<{ totalDocs: number }> = []
    for (const check of extraChecks) {
      if (check.expiresField) {
        // An expired hold is not a reference worth keeping the row for, but on
        // Postgres/SQLite it still trips the NOT NULL / ON DELETE SET NULL
        // contradiction this guard exists to pre-empt. Sweep it first.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (req.payload.delete as any)({
          collection: check.collection,
          req,
          where: {
            and: [
              { [check.field]: { equals: id } },
              { [check.expiresField]: { less_than: new Date().toISOString() } },
            ],
          },
        })
      }
      extras.push(
        (await countFn({
          collection: check.collection,
          req,
          where: { [check.field]: { equals: id } },
        })) as { totalDocs: number },
      )
    }

    const blocking = [
      { count: reservations.totalDocs, label: 'reservation' },
      ...extraChecks.map((check, index) => ({
        count: extras[index].totalDocs,
        label: check.label,
      })),
    ].filter((entry) => entry.count > 0)

    if (blocking.length > 0) {
      const total = blocking.reduce((sum, entry) => sum + entry.count, 0)
      const parts = blocking
        .map((entry) => `${entry.count} ${entry.label}${entry.count === 1 ? '' : 's'}`)
        .join(' and ')
      const verb = total === 1 ? 'still references' : 'still reference'

      throw new APIError(
        `Cannot delete this ${label}: ${parts} ${verb} it. Uncheck "active" to retire it instead — that stops new bookings while keeping existing ones intact.`,
        400,
      )
    }
  }
}

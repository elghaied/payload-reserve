import type { CollectionConfig, CollectionSlug } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { validateHoldSlot } from '../hooks/holds/validateHoldSlot.js'

/**
 * Short-lived claims on a slot, taken while a customer completes an external
 * step (typically payment) before the booking itself exists.
 *
 * A hold occupies its resource exactly as a blocking reservation does — see
 * `checkAvailability`, which folds unexpired holds into the same `Occupancy[]`
 * reduction as reservations and external busy intervals. Holds do not have
 * statuses, buffers, or items: they are one resource, one window, one clock.
 *
 * Rows are never trusted past `expiresAt`. Expiry is enforced by filtering at
 * read time rather than by a TTL index, because TTL indexes are MongoDB-only
 * and this collection has to behave identically on Postgres and SQLite. Expired
 * rows are swept opportunistically when a new hold is taken on the same
 * resource, so no background job is required.
 */
export function createHoldsCollection(config: ResolvedReservationPluginConfig): CollectionConfig {
  return {
    slug: config.slugs.holds,
    access: {
      // Every operation is closed, `read` included. `admin.hidden` only hides
      // the nav link — Payload still mounts `GET /api/<slug>` — and `token`
      // below is a BEARER SECRET with no field-level read rule of its own, so
      // any reader can release someone else's hold or book their slot with it.
      // There is no legitimate REST reader: the plugin's own endpoints, hooks
      // and services all reach this collection through the Local API with
      // `overrideAccess` at its default (`true`), which bypasses these rules —
      // `checkAvailability`'s find, `takeHold`'s create and expiry sweep,
      // `releaseHold`'s delete, and `createBooking`'s hold consumption.
      create: () => false,
      delete: () => false,
      read: () => false,
      update: () => false,
    },
    admin: {
      defaultColumns: ['resource', 'startTime', 'expiresAt'],
      description:
        'Short-lived slot claims taken during checkout. Rows past their expiry are ignored and swept automatically.',
      group: config.adminGroup,
      hidden: true,
      useAsTitle: 'token',
    },
    fields: [
      {
        name: 'resource',
        type: 'relationship',
        index: true,
        relationTo: config.slugs.resources as unknown as CollectionSlug,
        required: true,
      },
      {
        name: 'service',
        type: 'relationship',
        relationTo: config.slugs.services as unknown as CollectionSlug,
        required: true,
      },
      {
        name: 'startTime',
        type: 'date',
        index: true,
        required: true,
      },
      {
        name: 'endTime',
        type: 'date',
        required: true,
      },
      {
        name: 'guestCount',
        type: 'number',
        defaultValue: 1,
        min: 1,
      },
      {
        // Read-time expiry filter depends on this being indexed — every
        // availability check adds a range predicate over it.
        name: 'expiresAt',
        type: 'date',
        index: true,
        required: true,
      },
      {
        // The bearer secret. Whoever holds this may convert the hold into a
        // booking or release it; it is generated server-side and never accepted
        // from a request body.
        name: 'token',
        type: 'text',
        index: true,
        required: true,
        unique: true,
      },
      {
        name: 'customer',
        type: 'relationship',
        relationTo: config.slugs.customers as unknown as CollectionSlug,
      },
    ],
    hooks: {
      beforeChange: [validateHoldSlot(config)],
    },
    labels: {
      plural: 'Slot Holds',
      singular: 'Slot Hold',
    },
    timestamps: true,
  }
}

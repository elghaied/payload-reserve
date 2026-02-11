import type { CollectionConfig } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createCustomersCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  return {
    slug: config.slugs.customers,
    access: config.access.customers ?? {},
    admin: {
      group: config.adminGroup,
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        maxLength: 200,
        required: true,
      },
      {
        name: 'email',
        type: 'email',
        required: true,
        unique: true,
      },
      {
        name: 'phone',
        type: 'text',
        maxLength: 50,
      },
      {
        name: 'notes',
        type: 'textarea',
      },
      {
        name: 'bookings',
        type: 'join',
        collection: config.slugs.reservations,
        on: 'customer',
      },
    ],
  }
}

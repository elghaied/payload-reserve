import type { CollectionConfig, CollectionSlug } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

export function createCustomersCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  return {
    slug: config.slugs.customers,
    access: {
      admin: () => false,
      ...config.access.customers,
    },
    admin: {
      group: config.adminGroup,
      listSearchableFields: ['firstName', 'lastName', 'phone', 'email'],
      useAsTitle: 'firstName',
    },
    auth: true,
    fields: [
      {
        name: 'firstName',
        type: 'text',
        label: ({ t }) => (t as PluginT)('reservation:fieldFirstName'),
        maxLength: 200,
        required: true,
      },
      {
        name: 'lastName',
        type: 'text',
        label: ({ t }) => (t as PluginT)('reservation:fieldLastName'),
        maxLength: 200,
        required: true,
      },
      {
        name: 'phone',
        type: 'text',
        maxLength: 50,
      },
      {
        name: 'notes',
        type: 'textarea',
        label: ({ t }) => (t as PluginT)('reservation:fieldNotes'),
      },
      {
        name: 'bookings',
        type: 'join',
        collection: config.slugs.reservations as unknown as CollectionSlug,
        on: 'customer',
      },
    ],
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionCustomers'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionCustomer'),
    },
  }
}

import type { CollectionConfig, CollectionSlug } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { makeStandaloneCustomerAccess } from '../utilities/ownerAccess.js'
import { isPrivilegedUser } from '../utilities/userRoles.js'

export function createCustomersCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  return {
    slug: config.slugs.customers,
    access: {
      admin: () => false,
      ...makeStandaloneCustomerAccess(config),
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
        // Internal staff notes. Collection `read` lets a customer see their own
        // document, so without this the "visible only to admins" promise in
        // docs/collections.md was false: the customer got their own notes back
        // from /api/<customers>/me. Standalone only — under userCollection the
        // host owns the field and isPrivilegedUser is role-based there.
        access: {
          read: ({ req }) => isPrivilegedUser(req.user, config),
          update: ({ req }) => isPrivilegedUser(req.user, config),
        },
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

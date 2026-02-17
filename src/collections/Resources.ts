import type { CollectionConfig } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

export function createResourcesCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  return {
    slug: config.slugs.resources,
    access: config.access.resources ?? {},
    admin: {
      group: config.adminGroup,
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        label: ({ t }) => (t as PluginT)('reservation:fieldName'),
        ...(config.localized ? { localized: true } : {}),
        maxLength: 200,
        required: true,
      },
      {
        name: 'image',
        type: 'upload',
        label: ({ t }) => (t as PluginT)('reservation:fieldImage'),
        relationTo: config.slugs.media,
      },
      {
        name: 'description',
        type: 'textarea',
        label: ({ t }) => (t as PluginT)('reservation:fieldDescription'),
        ...(config.localized ? { localized: true } : {}),
      },
      {
        name: 'services',
        type: 'relationship',
        hasMany: true,
        label: ({ t }) => (t as PluginT)('reservation:fieldServices'),
        relationTo: config.slugs.services,
        required: true,
      },
      {
        name: 'active',
        type: 'checkbox',
        admin: {
          position: 'sidebar',
        },
        defaultValue: true,
        label: ({ t }) => (t as PluginT)('reservation:fieldActive'),
      },
      {
        name: 'quantity',
        type: 'number',
        admin: {
          position: 'sidebar',
        },
        defaultValue: 1,
        label: ({ t }) => (t as PluginT)('reservation:fieldQuantity'),
        min: 1,
        required: true,
      },
      {
        name: 'capacityMode',
        type: 'select',
        admin: {
          condition: (data) => (data?.quantity ?? 1) > 1,
          position: 'sidebar',
        },
        defaultValue: 'per-reservation',
        label: ({ t }) => (t as PluginT)('reservation:fieldCapacityMode'),
        options: [
          {
            label: ({ t }) => (t as PluginT)('reservation:capacityPerReservation'),
            value: 'per-reservation',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:capacityPerGuest'),
            value: 'per-guest',
          },
        ],
      },
      {
        name: 'timezone',
        type: 'text',
        admin: {
          position: 'sidebar',
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldTimezone'),
      },
    ],
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionResources'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionResources'),
    },
  }
}

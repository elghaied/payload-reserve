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
        maxLength: 200,
        required: true,
      },
      {
        name: 'description',
        type: 'textarea',
        label: ({ t }) => (t as PluginT)('reservation:fieldDescription'),
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
    ],
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionResources'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionResources'),
    },
  }
}

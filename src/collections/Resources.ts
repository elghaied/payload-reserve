import type { CollectionConfig } from 'payload'

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
        maxLength: 200,
        required: true,
      },
      {
        name: 'description',
        type: 'textarea',
      },
      {
        name: 'services',
        type: 'relationship',
        hasMany: true,
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
      },
    ],
  }
}

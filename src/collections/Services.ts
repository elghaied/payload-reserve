import type { CollectionConfig } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createServicesCollection(config: ResolvedReservationPluginConfig): CollectionConfig {
  return {
    slug: config.slugs.services,
    access: config.access.services ?? {},
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
        name: 'duration',
        type: 'number',
        label: 'Duration (minutes)',
        min: 1,
        required: true,
      },
      {
        name: 'price',
        type: 'number',
        admin: {
          step: 0.01,
        },
        min: 0,
      },
      {
        name: 'bufferTimeBefore',
        type: 'number',
        defaultValue: 0,
        label: 'Buffer Time Before (minutes)',
        min: 0,
      },
      {
        name: 'bufferTimeAfter',
        type: 'number',
        defaultValue: 0,
        label: 'Buffer Time After (minutes)',
        min: 0,
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

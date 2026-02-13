import type { CollectionConfig } from 'payload'

import type { PluginT } from '../translations/index.js'
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
        label: ({ t }) => (t as PluginT)('reservation:fieldName'),
        ...(config.localized ? { localized: true } : {}),
        maxLength: 200,
        required: true,
      },
      {
        name: 'description',
        type: 'textarea',
        label: ({ t }) => (t as PluginT)('reservation:fieldDescription'),
        ...(config.localized ? { localized: true } : {}),
      },
      {
        name: 'duration',
        type: 'number',
        label: ({ t }) => (t as PluginT)('reservation:fieldDurationMinutes'),
        min: 1,
        required: true,
      },
      {
        name: 'price',
        type: 'number',
        admin: {
          step: 0.01,
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldPrice'),
        min: 0,
      },
      {
        name: 'bufferTimeBefore',
        type: 'number',
        defaultValue: 0,
        label: ({ t }) => (t as PluginT)('reservation:fieldBufferTimeBefore'),
        min: 0,
      },
      {
        name: 'bufferTimeAfter',
        type: 'number',
        defaultValue: 0,
        label: ({ t }) => (t as PluginT)('reservation:fieldBufferTimeAfter'),
        min: 0,
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
      plural: ({ t }) => (t as PluginT)('reservation:collectionServices'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionServices'),
    },
  }
}

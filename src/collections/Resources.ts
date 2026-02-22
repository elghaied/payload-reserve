import type { CollectionConfig, CollectionSlug, Field } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { makeResourceOwnerAccess } from '../utilities/ownerAccess.js'

export function createResourcesCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  const rom = config.resourceOwnerMode
  const ownerField = rom?.ownerField ?? 'owner'

  // Build the owner field when resourceOwnerMode is enabled
  const ownerFieldDef: Field | null = rom
    ? {
        name: ownerField,
        type: 'relationship',
        admin: {
          position: 'sidebar',
        },
        hooks: {
          beforeChange: [
            ({ operation, req, value }) => {
              if (operation === 'create' && req.user) {return req.user.id}
              return value
            },
          ],
        },
        label: 'Owner',
        relationTo: config.slugs.customers as unknown as CollectionSlug,
        required: true,
      }
    : null

  // Determine access: app override → owner-mode auto-wired → unrestricted
  const access =
    config.access.resources ?? (rom ? makeResourceOwnerAccess(rom) : {})

  return {
    slug: config.slugs.resources,
    access,
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
        relationTo: config.slugs.media as unknown as CollectionSlug,
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
        relationTo: config.slugs.services as unknown as CollectionSlug,
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
      ...(ownerFieldDef ? [ownerFieldDef] : []),
    ],
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionResources'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionResources'),
    },
  }
}

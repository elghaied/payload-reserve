import type { CollectionConfig, CollectionSlug, Field } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { preventDeleteWhenReferenced } from '../hooks/shared/preventDeleteWhenReferenced.js'
import {
  composeAccess,
  makeServiceOwnerAccess,
  makeStandaloneCatalogAccess,
} from '../utilities/ownerAccess.js'

export function createServicesCollection(config: ResolvedReservationPluginConfig): CollectionConfig {
  const rom = config.resourceOwnerMode
  const ownedServices = rom?.ownedServices ?? false
  const ownerField = rom?.ownerField ?? 'owner'
  // Owner relationship points where owners/staff live — same resolution as
  // Resources; previously hardcoded to customers, breaking separate user setups.
  const ownerCollection =
    rom?.ownerCollection ?? config.staffProvisioning?.userCollection ?? config.slugs.customers

  // Owner field on Services (only when ownedServices: true)
  const ownerFieldDef: Field | null =
    rom && ownedServices
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
          label: ({ t }) => (t as PluginT)('reservation:fieldOwner'),
          relationTo: ownerCollection as unknown as CollectionSlug,
          required: true,
        }
      : null

  // Owner-mode base rules with any app overrides composed on top (per operation)
  // Owner-mode (with ownedServices) brings its own rules; standalone mode gets
  // staff-only writes (makeStandaloneCatalogAccess); userCollection mode stays
  // on Payload's default and the boot diagnostic says so.
  const catalogBase = config.userCollection ? {} : makeStandaloneCatalogAccess(config)
  const access = composeAccess(
    rom && ownedServices ? makeServiceOwnerAccess(rom, ownerField) : catalogBase,
    config.access.services,
  )

  return {
    slug: config.slugs.services,
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
      ...(config.hasMediaCollection
        ? [
            {
              name: 'image',
              type: 'upload' as const,
              label: ({ t }: { t: unknown }) => (t as PluginT)('reservation:fieldImage'),
              relationTo: config.slugs.media as unknown as CollectionSlug,
            },
          ]
        : []),
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
        name: 'durationType',
        type: 'select',
        defaultValue: 'fixed',
        label: ({ t }) => (t as PluginT)('reservation:fieldDurationType'),
        options: [
          {
            label: ({ t }) => (t as PluginT)('reservation:durationFixed'),
            value: 'fixed',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:durationFlexible'),
            value: 'flexible',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:durationFullDay'),
            value: 'full-day',
          },
        ],
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
        // max < 24h keeps the conflict-detection coarse pre-filter
        // (COARSE_MARGIN_MS = 24h) provably sufficient.
        name: 'bufferTimeBefore',
        type: 'number',
        defaultValue: 0,
        label: ({ t }) => (t as PluginT)('reservation:fieldBufferTimeBefore'),
        max: 1439,
        min: 0,
      },
      {
        name: 'bufferTimeAfter',
        type: 'number',
        defaultValue: 0,
        label: ({ t }) => (t as PluginT)('reservation:fieldBufferTimeAfter'),
        max: 1439,
        min: 0,
      },
      ...(config.hasResourceServicesField
        ? [
            {
              name: 'resources',
              type: 'join' as const,
              admin: {
                // A join's only write affordance is creating a BRAND-NEW resource
                // from here; it can never link an existing one (no allowAddExisting
                // in 3.86). Left off deliberately — `getInitialDrawerData` pre-fills
                // the target relationship as a SCALAR (`{ services: docID }`), while
                // `Resources.services` is hasMany and expects an array, so the
                // pre-fill is not reliably correct for this shape. Assignment belongs
                // on the Resource, which the description says.
                allowCreate: false,
                // Shows `active` in the table, so an admin can see at a glance that a
                // linked resource is disabled — the exact diagnosis this field exists
                // to make possible.
                defaultColumns: ['name', 'resourceType', 'active'],
                description: ({ t }: { t: unknown }) =>
                  (t as PluginT)('reservation:fieldResourcesDesc'),
              },
              collection: config.slugs.resources as unknown as CollectionSlug,
              // Joins default to 10 (buildJoinAggregation). A service performed by
              // more than 10 resources would otherwise silently show 10 of them.
              defaultLimit: 100,
              label: ({ t }: { t: unknown }) => (t as PluginT)('reservation:fieldResources'),
              on: 'services',
            },
          ]
        : []),
      {
        name: 'requiredResources',
        type: 'relationship',
        admin: {
          description: ({ t }) => (t as PluginT)('reservation:fieldRequiredResourcesDesc'),
        },
        hasMany: true,
        label: ({ t }) => (t as PluginT)('reservation:fieldRequiredResources'),
        relationTo: config.slugs.resources as unknown as CollectionSlug,
      },
      {
        name: 'allowGuestBooking',
        type: 'select',
        admin: {
          description: ({ t }) => (t as PluginT)('reservation:fieldAllowGuestBookingDesc'),
        },
        defaultValue: 'inherit',
        label: ({ t }) => (t as PluginT)('reservation:fieldAllowGuestBooking'),
        options: [
          {
            label: ({ t }) => (t as PluginT)('reservation:guestBookingInherit'),
            value: 'inherit',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:guestBookingEnabled'),
            value: 'enabled',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:guestBookingDisabled'),
            value: 'disabled',
          },
        ],
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
      ...(ownerFieldDef ? [ownerFieldDef] : []),
    ],
    hooks: {
      beforeDelete: [
        preventDeleteWhenReferenced({
          config,
          extraChecks: config.slotHolds.enabled
            ? [
                {
                  collection: config.slugs.holds,
                  expiresField: 'expiresAt',
                  field: 'service',
                  label: 'active hold',
                },
              ]
            : [],
          field: 'service',
          label: 'service',
        }),
      ],
    },
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionServices'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionServices'),
    },
  }
}

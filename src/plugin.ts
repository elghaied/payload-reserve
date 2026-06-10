import type { CollectionSlug, Config, Field } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import type { ReservationPluginConfig } from './types.js'

import { createCustomersCollection } from './collections/Customers.js'
import { createReservationsCollection } from './collections/Reservations.js'
import { createResourcesCollection } from './collections/Resources.js'
import { createSchedulesCollection } from './collections/Schedules.js'
import { createServicesCollection } from './collections/Services.js'
import { resolveConfig } from './defaults.js'
import { createCancelBookingEndpoint } from './endpoints/cancelBooking.js'
import { createCheckAvailabilityEndpoint } from './endpoints/checkAvailability.js'
import { createBookingEndpoint } from './endpoints/createBooking.js'
import { createCustomerSearchEndpoint } from './endpoints/customerSearch.js'
import { createGetSlotsEndpoint } from './endpoints/getSlots.js'
import { createResourceAvailabilityEndpoint } from './endpoints/resourceAvailability.js'
import { provisionStaffResource } from './hooks/users/provisionStaffResource.js'
import { type PluginT, translations } from './translations/index.js'
import { applyCollectionOverride } from './utilities/collectionOverrides.js'

export const payloadReserve =
  (pluginOptions: ReservationPluginConfig = {}) =>
  (config: Config): Config => {
    const resolved = resolveConfig(pluginOptions)

    // Detect localization from the Payload config
    if (config.localization) {
      resolved.localized = true
    }

    if (!config.collections) {
      config.collections = []
    }

    if (resolved.userCollection) {
      // Extend the existing auth collection with customer fields
      const targetCollection = config.collections.find(
        (col) => col.slug === resolved.userCollection,
      )

      if (!targetCollection) {
        // Fail loudly rather than silently skipping field injection and pointing
        // the customers slug at a collection that doesn't exist (review C2).
        throw new Error(
          `payload-reserve: userCollection "${resolved.userCollection}" was not found in config.collections. ` +
            `Define it before payloadReserve() runs, or correct the slug.`,
        )
      }

      {
        // Collect existing field names for deduplication check
        const existingFieldNames = new Set(
          targetCollection.fields
            .map((field) => ('name' in field ? field.name : undefined))
            .filter(Boolean),
        )

        // Fields to inject if not already present. `name` is added so that
        // admin.useAsTitle: 'name' works out of the box on the extended user
        // collection (matches the v1.0.0 behaviour documented in README/SKILL).
        const fieldsToAdd: Field[] = [
          {
            name: 'name',
            type: 'text',
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
          },
          {
            name: 'bookings',
            type: 'join',
            collection: resolved.slugs.reservations as unknown as CollectionSlug,
            on: 'customer',
          },
        ]

        for (const field of fieldsToAdd) {
          const fieldName = 'name' in field ? field.name : undefined
          if (fieldName && !existingFieldNames.has(fieldName)) {
            targetCollection.fields.push(field)
          }
        }
      }

      // Point the customers slug at the user collection so other parts of the
      // plugin (endpoints, hooks) reference the correct collection
      resolved.slugs.customers = resolved.userCollection
    }

    // The slugs this plugin is about to register (Customers only in standalone mode)
    const slugsToRegister = [
      resolved.slugs.services,
      resolved.slugs.resources,
      resolved.slugs.schedules,
      resolved.slugs.reservations,
      ...(resolved.userCollection ? [] : [resolved.slugs.customers]),
    ]

    // C11: fail with a clear, actionable error on slug collision instead of
    // Payload's generic DuplicateCollection throw.
    for (const slug of slugsToRegister) {
      if (config.collections.some((col) => col.slug === slug)) {
        throw new Error(
          `payload-reserve: a collection with slug "${slug}" already exists. ` +
            `Override the plugin's slug via the \`slugs\` option.`,
        )
      }
    }

    const ov = resolved.collectionOverrides
    config.collections.push(
      applyCollectionOverride(createServicesCollection(resolved), ov.services),
      applyCollectionOverride(createResourcesCollection(resolved), ov.resources),
      applyCollectionOverride(createSchedulesCollection(resolved), ov.schedules),
      applyCollectionOverride(createReservationsCollection(resolved), ov.reservations),
      // The customers override applies only in standalone mode; in userCollection
      // mode the host owns that collection and can edit it directly.
      ...(resolved.userCollection
        ? []
        : [applyCollectionOverride(createCustomersCollection(resolved), ov.customers)]),
    )

    // C3: collections are registered (above) even when disabled so the DB schema
    // stays stable; behavior (hooks, endpoints, admin, provisioning) is inert.
    if (resolved.disabled) {
      for (const slug of slugsToRegister) {
        const col = config.collections.find((c) => c.slug === slug)
        if (col) {
          delete col.hooks
        }
      }
      return config
    }

    // Register custom endpoints
    if (!config.endpoints) {config.endpoints = []}
    config.endpoints.push(
      createCancelBookingEndpoint(resolved),
      createCheckAvailabilityEndpoint(resolved),
      createBookingEndpoint(resolved),
      createCustomerSearchEndpoint(resolved),
      createGetSlotsEndpoint(resolved),
      createResourceAvailabilityEndpoint(resolved),
    )

    // Wire staff auto-provisioning onto the staff user collection
    if (resolved.staffProvisioning) {
      const staffUserSlug = resolved.staffProvisioning.userCollection
      const staffCollection = config.collections.find((col) => col.slug === staffUserSlug)
      if (!staffCollection) {
        throw new Error(
          `staffProvisioning.userCollection "${staffUserSlug}" was not found in config.collections`,
        )
      }
      staffCollection.hooks = {
        ...staffCollection.hooks,
        afterChange: [
          ...(staffCollection.hooks?.afterChange ?? []),
          provisionStaffResource(resolved),
        ],
      }
    }

    // Set up admin configuration
    if (!config.admin) {config.admin = {}}
    if (!config.admin.components) {config.admin.components = {}}

    // Store slugs and status machine in admin custom for component access
    if (!config.admin.custom) {config.admin.custom = {}}
    config.admin.custom.reservationSlugs = {
      ...resolved.slugs,
    }
    config.admin.custom.reservationStatusMachine = resolved.statusMachine
    config.admin.custom.reservationTenant = resolved.multiTenant
    config.admin.custom.reservationTimezone = resolved.timezone

    // Add dashboard widget
    if (!config.admin.dashboard) {
      config.admin.dashboard = { widgets: [] }
    }
    if (!config.admin.dashboard.widgets) {
      config.admin.dashboard.widgets = []
    }
    config.admin.dashboard.widgets.push({
      slug: 'reservation-todays-reservations',
      Component: 'payload-reserve/rsc#DashboardWidgetServer',
      label: ({ t }) => (t as PluginT)('reservation:dashboardTitle'),
      maxWidth: 'large',
      minWidth: 'medium',
    })

    // Add availability overview as custom admin view
    if (!config.admin.components.views) {
      config.admin.components.views = {}
    }
    ;(config.admin.components.views as Record<string, unknown>)['reservation-availability'] = {
      Component: 'payload-reserve/client#AvailabilityOverview',
      path: '/reservation-availability',
    }

    // Merge plugin translations (user translations take precedence)
    config.i18n = {
      ...(config.i18n ?? {}),
      translations: deepMergeSimple(
        translations,
        (config.i18n?.translations as Record<string, Record<string, unknown>>) ?? {},
      ),
    }

    return config
  }

import type { Config, Field } from 'payload'

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
import { translations } from './translations/index.js'

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

    if (resolved.disabled) {
      return config
    }

    if (resolved.userCollection) {
      // Extend the existing auth collection with customer fields
      const targetCollection = config.collections.find(
        (col) => col.slug === resolved.userCollection,
      )

      if (targetCollection) {
        // Collect existing field names for deduplication check
        const existingFieldNames = new Set(
          targetCollection.fields
            .map((field) => ('name' in field ? field.name : undefined))
            .filter(Boolean),
        )

        // Fields to inject if not already present
        const fieldsToAdd: Field[] = [
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
            collection: resolved.slugs.reservations as 'reservations',
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

      // Push only the 4 domain collections (no standalone Customers)
      config.collections.push(
        createServicesCollection(resolved),
        createResourcesCollection(resolved),
        createSchedulesCollection(resolved),
        createReservationsCollection(resolved),
      )
    } else {
      // Default behaviour: push all 5 collections including standalone Customers
      config.collections.push(
        createServicesCollection(resolved),
        createResourcesCollection(resolved),
        createSchedulesCollection(resolved),
        createReservationsCollection(resolved),
        createCustomersCollection(resolved),
      )
    }

    // Register custom endpoints
    if (!config.endpoints) {config.endpoints = []}
    config.endpoints.push(
      createCancelBookingEndpoint(resolved),
      createCheckAvailabilityEndpoint(resolved),
      createBookingEndpoint(resolved),
      createCustomerSearchEndpoint(resolved),
      createGetSlotsEndpoint(resolved),
    )

    // Set up admin configuration
    if (!config.admin) {config.admin = {}}
    if (!config.admin.components) {config.admin.components = {}}

    // Store slugs and status machine in admin custom for component access
    if (!config.admin.custom) {config.admin.custom = {}}
    config.admin.custom.reservationSlugs = {
      ...resolved.slugs,
    }
    config.admin.custom.reservationStatusMachine = resolved.statusMachine

    // Add dashboard widget
    if (!config.admin.dashboard) {
      config.admin.dashboard = { widgets: [] }
    }
    if (!config.admin.dashboard.widgets) {
      config.admin.dashboard.widgets = []
    }
    config.admin.dashboard.widgets.push({
      slug: 'reservation-todays-reservations',
      ComponentPath: 'payload-reserve/rsc#DashboardWidgetServer',
      label: 'Today\'s Reservations',
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
    if (!config.i18n) {config.i18n = {}}
    ;(config.i18n as Record<string, unknown>).translations = deepMergeSimple(
      translations,
      (config.i18n as Record<string, unknown>).translations ?? {},
    )

    return config
  }

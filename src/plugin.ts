import type { Config } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import type { ReservationPluginConfig } from './types.js'

import { createCustomersCollection } from './collections/Customers.js'
import { createReservationsCollection } from './collections/Reservations.js'
import { createResourcesCollection } from './collections/Resources.js'
import { createSchedulesCollection } from './collections/Schedules.js'
import { createServicesCollection } from './collections/Services.js'
import { resolveConfig } from './defaults.js'
import { createCustomerSearchEndpoint } from './endpoints/customerSearch.js'
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

    // Add the 5 plugin collections
    config.collections.push(
      createServicesCollection(resolved),
      createResourcesCollection(resolved),
      createSchedulesCollection(resolved),
      createReservationsCollection(resolved),
      createCustomersCollection(resolved),
    )

    // Register custom endpoints
    if (!config.endpoints) {config.endpoints = []}
    config.endpoints.push(createCustomerSearchEndpoint(resolved))

    // Set up admin configuration
    if (!config.admin) {config.admin = {}}
    if (!config.admin.components) {config.admin.components = {}}

    // Store slugs in admin custom for component access
    if (!config.admin.custom) {config.admin.custom = {}}
    config.admin.custom.reservationSlugs = {
      ...resolved.slugs,
    }

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

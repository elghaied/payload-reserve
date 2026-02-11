import type { Config } from 'payload'

import type { ReservationPluginConfig } from './types.js'

import { createCustomersCollection } from './collections/Customers.js'
import { createReservationsCollection } from './collections/Reservations.js'
import { createResourcesCollection } from './collections/Resources.js'
import { createSchedulesCollection } from './collections/Schedules.js'
import { createServicesCollection } from './collections/Services.js'
import { resolveConfig } from './defaults.js'

export const reservationPlugin =
  (pluginOptions: ReservationPluginConfig = {}) =>
  (config: Config): Config => {
    const resolved = resolveConfig(pluginOptions)

    if (!config.collections) {
      config.collections = []
    }

    if (resolved.disabled) {
      return config
    }

    // Add all 5 collections
    config.collections.push(
      createServicesCollection(resolved),
      createResourcesCollection(resolved),
      createSchedulesCollection(resolved),
      createCustomersCollection(resolved),
      createReservationsCollection(resolved),
    )

    // Set up admin configuration
    if (!config.admin) {config.admin = {}}
    if (!config.admin.components) {config.admin.components = {}}

    // Store slugs in admin custom for component access
    if (!config.admin.custom) {config.admin.custom = {}}
    config.admin.custom.reservationSlugs = resolved.slugs

    // Add dashboard widget
    if (!config.admin.components.beforeDashboard) {
      config.admin.components.beforeDashboard = []
    }
    config.admin.components.beforeDashboard.push(
      'reservation-plugin/rsc#DashboardWidgetServer',
    )

    // Add availability overview as custom admin view
    if (!config.admin.components.views) {
      config.admin.components.views = {}
    }
    ;(config.admin.components.views as Record<string, unknown>)['reservation-availability'] = {
      Component: 'reservation-plugin/client#AvailabilityOverview',
      path: '/reservation-availability',
    }

    return config
  }

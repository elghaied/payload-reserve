import type { Config, Field } from 'payload'

import { deepMergeSimple } from 'payload/shared'

import type { ReservationPluginConfig } from './types.js'

import { createReservationsCollection } from './collections/Reservations.js'
import { createResourcesCollection } from './collections/Resources.js'
import { createSchedulesCollection } from './collections/Schedules.js'
import { createServicesCollection } from './collections/Services.js'
import { resolveConfig } from './defaults.js'
import { translations } from './translations/index.js'

/** Check whether a top-level field with the given name already exists */
const hasField = (fields: Field[], name: string): boolean =>
  fields.some((f) => 'name' in f && f.name === name)

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

    // Add the 4 plugin collections
    config.collections.push(
      createServicesCollection(resolved),
      createResourcesCollection(resolved),
      createSchedulesCollection(resolved),
      createReservationsCollection(resolved),
    )

    // Extend the existing user collection with customer fields
    const userCol = config.collections.find((c) => c.slug === resolved.userCollection)
    if (userCol) {
      const fieldsToAdd: Field[] = [
        { name: 'name', type: 'text', maxLength: 200 },
        { name: 'phone', type: 'text', maxLength: 50 },
        { name: 'notes', type: 'textarea' },
        {
          name: 'bookings',
          type: 'join',
          collection: resolved.slugs.reservations,
          on: 'customer',
        },
      ]

      for (const field of fieldsToAdd) {
        if (!hasField(userCol.fields, (field as { name: string }).name)) {
          userCol.fields.push(field)
        }
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[payload-reserve] Could not find collection "${resolved.userCollection}" to extend with customer fields. ` +
          'Make sure your Payload config defines this collection before the reservation plugin runs.',
      )
    }

    // Set up admin configuration
    if (!config.admin) {config.admin = {}}
    if (!config.admin.components) {config.admin.components = {}}

    // Store slugs in admin custom for component access
    if (!config.admin.custom) {config.admin.custom = {}}
    config.admin.custom.reservationSlugs = {
      ...resolved.slugs,
      userCollection: resolved.userCollection,
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

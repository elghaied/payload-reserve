import type { CollectionSlug, Config, Field } from 'payload'

import { flattenAllFields, getFieldByPath } from 'payload'
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
import { createEffectiveTimezoneEndpoint } from './endpoints/effectiveTimezone.js'
import { createGetSlotsEndpoint } from './endpoints/getSlots.js'
import { createResourceAvailabilityEndpoint } from './endpoints/resourceAvailability.js'
import { provisionStaffResource } from './hooks/users/provisionStaffResource.js'
import { type PluginT, translations } from './translations/index.js'
import { applyCollectionOverride } from './utilities/collectionOverrides.js'
import { collectionHasTenantField } from './utilities/tenantFilter.js'

/**
 * All named field paths reachable from a field list, descending through
 * presentational containers (tabs, rows, collapsibles, unnamed groups) that
 * don't create their own data nesting — so dedup catches a field declared
 * inside one of them. Named groups/arrays DO nest data, so we don't recurse
 * into them (a `name` inside a named group is a different path).
 */
function collectFieldNames(fields: Field[]): Set<string> {
  const names = new Set<string>()
  const walk = (list: Field[]): void => {
    for (const field of list) {
      if ('name' in field && field.name) {
        names.add(field.name)
      } else if ('tabs' in field && Array.isArray(field.tabs)) {
        for (const tab of field.tabs) {
          if ('name' in tab && tab.name) {
            names.add(tab.name)
          } else if (Array.isArray(tab.fields)) {
            walk(tab.fields)
          }
        }
      } else if ('fields' in field && Array.isArray(field.fields)) {
        // row / collapsible / unnamed group
        walk(field.fields)
      }
    }
  }
  walk(fields)
  return names
}

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
        // Collect existing field names — descend into presentational containers
        // (tabs/rows/collapsibles/groups) so a field nested there isn't
        // re-injected at the top level (review C4).
        const existingFieldNames = collectFieldNames(targetCollection.fields)

        // Fields to inject if not already present. `name` is added so that
        // admin.useAsTitle: 'name' works out of the box on the extended user
        // collection (matches the v1.0.0 behaviour documented in README/SKILL).
        // It is NOT required — an existing users collection may have rows
        // without a name, and forcing required would fail their next update (C4).
        const fieldsToAdd: Field[] = [
          {
            name: 'name',
            type: 'text',
            maxLength: 200,
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

    // Image upload fields are added only when the media collection actually
    // exists, so installs without one don't hit an opaque init error (C8).
    resolved.hasMediaCollection = config.collections.some(
      (col) => col.slug === resolved.slugs.media,
    )

    const ov = resolved.collectionOverrides
    const resourcesCollection = applyCollectionOverride(
      createResourcesCollection(resolved),
      ov.resources,
    )
    // The join's `on: 'services'` only resolves when Payload's own
    // sanitizeJoinField can resolve it — mirror that resolution exactly
    // (flattenAllFields + getFieldByPath) rather than re-implementing the
    // traversal, so this can't drift from Payload's behavior on upgrade.
    // Unnamed containers (row/collapsible/unnamed group/unnamed tabs) are
    // hoisted by flattenAllFields and still resolve; only removal, renaming,
    // or nesting inside a NAMED group/tab breaks it — that's the case this
    // gate exists to catch instead of crashing init with InvalidFieldJoin.
    const resourceServicesTarget = getFieldByPath({
      // A throwaway copy: flattenAllFields caches by array identity even when
      // `cache` isn't passed, and sanitizeFields mutates-and-returns the same
      // array instance. Flattening resourcesCollection.fields directly would
      // seed that cache with a pre-sanitization snapshot under a key Payload's
      // own sanitizeJoinField (cache: true) could later be served from.
      fields: flattenAllFields({ fields: [...resourcesCollection.fields] }),
      path: 'services',
    })
    resolved.hasResourceServicesField =
      resourceServicesTarget !== null &&
      (resourceServicesTarget.field.type === 'relationship' ||
        resourceServicesTarget.field.type === 'upload')

    config.collections.push(
      applyCollectionOverride(createServicesCollection(resolved), ov.services),
      resourcesCollection,
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

    // Boot diagnostics. ONE wrapper for all of them so a second condition can
    // never double-wrap onInit. Each check is evaluated at init, not here:
    // payloadReserve runs BEFORE multi-tenant, so at plugin time no tenant
    // field exists on anything yet.
    const hostOnInit = config.onInit
    config.onInit = async (payload) => {
      await hostOnInit?.(payload)
      try {
        // The Services `resources` join is omitted when a collectionOverrides.resources
        // override removed, renamed, or nested `services` inside a NAMED group/tab.
        // hasResourceServicesField is only ever false because of such an override —
        // the default Resources collection always carries the field — so this cannot
        // fire spuriously. Warn rather than throw: restructuring your own collection
        // is a supported customization, not invalid config.
        if (!resolved.hasResourceServicesField) {
          payload.logger.warn(
            `payload-reserve: the "${resolved.slugs.services}" collection's read-only "resources" join was skipped because "${resolved.slugs.resources}.services" is not a top-level relationship field. A collectionOverrides.resources override removed, renamed, or nested it inside a named group or tab.`,
          )
        }

        // Multi-tenant only scopes collections listed in ITS OWN `collections`
        // option, and stays silent about slugs you never listed. So a consumer
        // can enable multi-tenant, forget these collections, and get no signal
        // while every booking stays globally readable.
        const tenantField = resolved.multiTenant.tenantField
        const all = (payload.config.collections ?? []) as Array<{ fields?: unknown[]; slug: string }>
        const scoped = all.filter((c) => collectionHasTenantField(c, tenantField))
        if (scoped.length > 0) {
          const unscoped = [
            resolved.slugs.reservations,
            resolved.slugs.resources,
            resolved.slugs.schedules,
            resolved.slugs.services,
          ].filter((slug) => {
            const collection = all.find((c) => c.slug === slug)
            return collection && !collectionHasTenantField(collection, tenantField)
          })
          if (unscoped.length > 0) {
            payload.logger.warn(
              `payload-reserve: these collections are NOT tenant-scoped: ${unscoped.join(', ')}. Other collections in this config carry a "${tenantField}" field, so multi-tenancy appears to be enabled — add these slugs to the multi-tenant plugin's "collections" option, or every booking stays readable across tenants.`,
            )
          }
        }
      } catch {
        // A diagnostic must never break boot — that is the whole reason these
        // are warnings and not throws. The host onInit await stays OUTSIDE.
      }
    }

    // Register custom endpoints
    if (!config.endpoints) {config.endpoints = []}
    config.endpoints.push(
      createCancelBookingEndpoint(resolved),
      createCheckAvailabilityEndpoint(resolved),
      createBookingEndpoint(resolved),
      createCustomerSearchEndpoint(resolved),
      createEffectiveTimezoneEndpoint(resolved),
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

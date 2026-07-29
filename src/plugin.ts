import type { CollectionSlug, Config, Field } from 'payload'

import { flattenAllFields, getFieldByPath } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import type { ReservationPluginConfig } from './types.js'

import { createCustomersCollection } from './collections/Customers.js'
import { createHoldsCollection } from './collections/Holds.js'
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
import { createHoldSlotEndpoint } from './endpoints/holdSlot.js'
import { createReleaseSlotEndpoint } from './endpoints/releaseSlot.js'
import { createResourceAvailabilityEndpoint } from './endpoints/resourceAvailability.js'
import { provisionStaffResource } from './hooks/users/provisionStaffResource.js'
import { type PluginT, translations } from './translations/index.js'
import { applyCollectionOverride } from './utilities/collectionOverrides.js'
import { collectionHasTenantField } from './utilities/tenantFilter.js'
import { supportsTransactions } from './utilities/transactionSupport.js'

/**
 * The array field `@payloadcms/plugin-multi-tenant` pushes onto the admin users
 * collection to hold a user's tenant memberships. Its own default
 * (`plugin-multi-tenant/dist/defaults.js`); consumers can rename it, which is
 * one of the blind spots the boot diagnostic's comment calls out.
 */
const MT_TENANTS_ARRAY_FIELD = 'tenants'

/** True if the collection has a top-level `array` field named `fieldName`. */
function collectionHasArrayField(
  collection: { fields?: unknown[] } | null | undefined,
  fieldName: string,
): boolean {
  if (!collection || !Array.isArray(collection.fields)) {
    return false
  }
  return collection.fields.some((f) => {
    if (typeof f !== 'object' || f === null) {
      return false
    }
    const field = f as { name?: string; type?: string }
    return field.name === fieldName && field.type === 'array'
  })
}

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
      // Only when slot holds are enabled — an install that never opts in gets no
      // extra collection and no schema change.
      ...(resolved.slotHolds.enabled ? [createHoldsCollection(resolved)] : []),
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
        //
        // Detecting "multi-tenant is enabled" is a HEURISTIC — the plugin
        // exposes nothing at init to check directly — so we look for two
        // independent traces of it and warn if EITHER shows up. Each covers the
        // other's blind spot:
        //   1. some collection carries a top-level `tenantField`. Misses the
        //      consumer who scoped ONLY this plugin's collections and forgot
        //      every one of them, leaving nothing else with the field.
        //   2. an auth collection carries multi-tenant's `tenants` membership
        //      array. Misses installs that set
        //      `tenantsArrayField.includeDefaultField: false` or renamed it.
        // Neither is exact, and the union can still fire on a config that
        // merely looks tenant-shaped — hence a warning, never a throw.
        const tenantField = resolved.multiTenant.tenantField
        const all = (payload.config.collections ?? []) as Array<{
          auth?: unknown
          fields?: unknown[]
          slug: string
        }>
        const scoped = all.filter((c) => collectionHasTenantField(c, tenantField))
        const hasMembershipArray = all.some(
          (c) => Boolean(c.auth) && collectionHasArrayField(c, MT_TENANTS_ARRAY_FIELD),
        )
        if (scoped.length > 0 || hasMembershipArray) {
          const candidates = [
            resolved.slugs.reservations,
            resolved.slugs.resources,
            resolved.slugs.schedules,
            resolved.slugs.services,
          ]
          // Standalone mode only. `customers` is then a plugin-generated auth
          // collection holding the PII that customer-search reads, so leaving it
          // unscoped leaks every tenant's customers — the case most worth
          // catching. Under `userCollection` that slug points at the HOST's auth
          // collection, which multi-tenant scopes via the `tenants` membership
          // array rather than a flat field, so checking it would always
          // false-positive.
          if (!resolved.userCollection) {
            candidates.push(resolved.slugs.customers)
          }
          const unscoped = candidates.filter((slug) => {
            const collection = all.find((c) => c.slug === slug)
            return collection && !collectionHasTenantField(collection, tenantField)
          })
          if (unscoped.length > 0) {
            payload.logger.warn(
              `payload-reserve: these collections are NOT tenant-scoped: ${unscoped.join(', ')}. This config looks like it enables multi-tenancy (another collection carries a "${tenantField}" field, or an auth collection carries a "${MT_TENANTS_ARRAY_FIELD}" membership array) — detection is a heuristic, so disregard this if you are not using multi-tenancy. Otherwise add these slugs to the multi-tenant plugin's "collections" option, or their documents stay readable across tenants.`,
            )
          }

          // createBooking's tenant-membership probe (callerMayUseTenant, in
          // src/utilities/tenantTimezone.ts) is a real membership check only
          // when the caller authenticates against the SAME collection
          // multi-tenant wraps as its admin/tenant-owning collection —
          // `withTenantAccess` only applies its membership constraint under
          // that condition. In standalone mode a customer authenticates
          // against `slugs.customers`, a collection multi-tenant never wraps,
          // so the probe's tenants-collection read passes for ANY tenant id
          // for a logged-in customer: this is detectable (unlike a host
          // setting multi-tenant's own `useTenantsCollectionAccess: false`,
          // which is not observable from here), so warn about it.
          if (!resolved.userCollection) {
            payload.logger.warn(
              `payload-reserve: in standalone mode (no "userCollection"), /reserve/book's tenant-membership check does not actually verify a logged-in customer's membership — customers authenticate against "${resolved.slugs.customers}", a collection multi-tenant never wraps, so its probe read passes for any tenant id. A malicious customer could still supply an explicit foreign tenant. Set "userCollection" to point at multi-tenant's own admin auth collection, or add your own tenant-membership check in front of /reserve/book.`,
            )
          }
        }

        // The booking lock only serializes anything inside a transaction. On a
        // standalone mongod Payload skips transactions entirely, so the lock
        // degrades to a no-op and concurrent bookings double-book again — with
        // no error anywhere. Say so at boot; there is no runtime signal.
        if (!resolved.disabled && !(await supportsTransactions(payload))) {
          payload.logger.warn(
            'payload-reserve: this database does not support transactions, so concurrent bookings for the same slot can double-book. MongoDB needs a replica set (even single-node) for transaction support. Postgres supports transactions by default. SQLite requires transactionOptions to be set on the adapter, or it silently runs without them.',
          )
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
      // Only when slot holds are enabled — an install that never opts in gets
      // no new routes.
      ...(resolved.slotHolds.enabled
        ? [createHoldSlotEndpoint(resolved), createReleaseSlotEndpoint(resolved)]
        : []),
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

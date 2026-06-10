# Configuration

Full reference for all `payloadReserve()` plugin options.

All options are optional — the plugin works with sensible defaults.

## Full Config Example

```typescript
import { payloadReserve } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'

payloadReserve({
  // Disable the plugin's behavior while keeping the config type-safe.
  // A disabled plugin still REGISTERS its collections (so the DB schema stays
  // stable — toggling this no longer drops tables) but strips collection-level
  // hooks and skips endpoints, admin components, and staff provisioning. A
  // disabled plugin with an invalid sub-config no longer throws at boot.
  disabled: false,

  // IANA timezone governing all schedule resolution: what HH:mm schedule times
  // mean, which calendar day a date=YYYY-MM-DD query maps to, exception-day
  // matching, and full-day boundaries. UTC servers behave as before; non-UTC
  // servers now resolve the correct day. Validated at init (invalid name throws).
  timezone: 'UTC',

  // Admin group label for all reservation collections
  adminGroup: 'Reservations',

  // Minutes of buffer between reservations when a service has none defined
  defaultBufferTime: 0,

  // Minimum hours of notice required before a cancellation is allowed
  cancellationNoticePeriod: 24,

  // Extend an existing auth collection instead of creating a standalone Customers collection.
  // The named collection must exist in your Payload config before the plugin runs.
  userCollection: 'users',

  // Override collection slugs
  slugs: {
    services: 'services',
    resources: 'resources',
    schedules: 'schedules',
    reservations: 'reservations',
    customers: 'customers',
    media: 'media',
  },

  // Override access control per collection
  access: {
    services: {
      read: () => true,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
    },
    resources: { read: () => true },
    schedules: { read: () => true },
    reservations: { create: () => true },
    customers: { create: () => true },
  },

  // Configurable status machine
  statusMachine: {
    statuses: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    defaultStatus: 'pending',
    terminalStatuses: ['completed', 'cancelled', 'no-show'],
    blockingStatuses: ['pending', 'confirmed'],
    transitions: {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled', 'no-show'],
      completed: [],
      cancelled: [],
      'no-show': [],
    },
  },

  // Plugin hook callbacks — see hooks-api.md
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        // Send confirmation email, etc.
      },
    ],
  },

  // Per-collection overrides for the generated collections. Each entry is
  // Omit<Partial<CollectionConfig>, 'fields' | 'slug'> with a `fields` function:
  //   - `fields({ defaultFields })` returns the final field list (append/reorder/replace)
  //   - supplied `hooks` MERGE with the plugin's (plugin hooks always run, first)
  //   - `access` composes per operation (omitted operations keep the plugin's rules)
  //   - `slug` is ignored (use `slugs` instead)
  // The `customers` override applies only in standalone mode (no `userCollection`).
  // This supersedes the deprecated `extraReservationFields`.
  collectionOverrides: {
    reservations: {
      admin: { defaultColumns: ['service', 'startTime', 'status'] },
      fields: ({ defaultFields }) => [
        ...defaultFields,
        { name: 'paymentReminderSent', type: 'checkbox', defaultValue: false },
      ],
    },
  },

  // DEPRECATED — use `collectionOverrides.reservations.fields` instead.
  // Still works: extra fields appended to the Reservations collection.
  extraReservationFields: [
    { name: 'paymentReminderSent', type: 'checkbox', defaultValue: false },
  ],

  // Allow bookings without a customer account (per-service override available)
  allowGuestBooking: false,

  // Customize the option list for Resource.resourceType (first entry is the field default).
  // Passing an empty array throws at init.
  resourceTypes: ['staff', 'equipment', 'room'],

  // Customize the option list for Schedule.exceptions[].type.
  // Passing an empty array throws at init.
  leaveTypes: ['vacation', 'sick', 'personal', 'closure', 'other'],

  // Resource-owner multi-tenancy (opt-in). Adds an owner relationship to Resources
  // (and optionally Services) so owners only see their own records.
  resourceOwnerMode: {
    // Roles that bypass ownership scoping and see all records.
    // Default: anyone whose req.user.collection is the admin collection.
    adminRoles: ['admin'],
    // User field consulted for admin detection. Defaults to
    // staffProvisioning.roleField, then 'role'. Set this when your users store
    // roles in a `roles: string[]` field so they aren't mis-detected.
    roleField: 'role',
    // Also add an owner field to Services (default: false — Services are platform-managed).
    ownedServices: false,
    // Field name for the owner relationship on Resources (default: 'owner').
    ownerField: 'owner',
    // Collection the owner field relates to. Defaults to staffProvisioning.userCollection
    // when set, otherwise slugs.customers. Set this when owners live in a different
    // collection than your customers.
    ownerCollection: 'users',
  },

  // Auto-provision a Resource for staff-role users (opt-in; REQUIRES resourceOwnerMode).
  // On user create/update, a paired Resource owned by that user is created (idempotent).
  staffProvisioning: {
    // Role value(s) that mark a user as staff. Required, must be non-empty.
    staffRoles: ['stylist', 'therapist'],
    // Auth collection holding staff users. Defaults to top-level userCollection.
    userCollection: 'users',
    // Field on the user holding the role (default: 'role').
    roleField: 'role',
    // resourceType stamped on the provisioned Resource (default: 'staff'; must be a valid resourceType).
    resourceType: 'staff',
    // User field copied into Resource.name (default: 'name', falls back to email).
    nameFrom: 'name',
    // Escape hatch to stamp tenant IDs / custom fields before the Resource is saved.
    beforeCreate: ({ data, req, user }) => data,
  },
})
```

> **`staffProvisioning` requires `resourceOwnerMode`.** Configuring `staffProvisioning` without `resourceOwnerMode` throws at init. `staffProvisioning.staffRoles` must be a non-empty array, and `staffProvisioning.userCollection` is required when the top-level `userCollection` is unset. The provisioned Resource is created by impersonating the staff user (so `owner` is always that user), is idempotent (deduped by owner), is non-blocking (failures are logged, not thrown), and is never auto-deleted on demotion.

## Defaults Table

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable plugin behavior. Collections still register (schema stays stable), but collection hooks are stripped and endpoints/admin/provisioning are skipped; an invalid sub-config no longer throws at boot |
| `timezone` | `string` | `'UTC'` | IANA timezone governing schedule resolution, day boundaries, exception matching, and full-day windows. Invalid name throws at init |
| `adminGroup` | `string` | `'Reservations'` | Admin panel group label |
| `defaultBufferTime` | `number` | `0` | Default buffer between bookings (minutes) |
| `cancellationNoticePeriod` | `number` | `24` | Minimum hours notice for cancellation |
| `userCollection` | `string` | `undefined` | Existing auth collection slug to extend |
| `slugs.services` | `string` | `'services'` | Services collection slug |
| `slugs.resources` | `string` | `'resources'` | Resources collection slug |
| `slugs.schedules` | `string` | `'schedules'` | Schedules collection slug |
| `slugs.reservations` | `string` | `'reservations'` | Reservations collection slug |
| `slugs.customers` | `string` | `'customers'` | Customers collection slug |
| `slugs.media` | `string` | `'media'` | Media collection slug (used by image fields) |
| `statusMachine` | `Partial<StatusMachineConfig>` | Default 5-status machine | Custom status machine (validated at init) |
| `hooks` | `ReservationPluginHooks` | `{}` | Plugin hook callbacks |
| `collectionOverrides` | `Record<collection, CollectionOverride>` | `{}` | Per-collection overrides (`services`/`resources`/`schedules`/`reservations`/`customers`). `fields` is a function `({ defaultFields }) => Field[]`; `hooks` merge with the plugin's (plugin first); `access` composes per operation; `slug` ignored. `customers` applies only in standalone mode |
| `extraReservationFields` | `Field[]` | `[]` | **Deprecated** — use `collectionOverrides.reservations.fields`. Still appends extra Payload fields to the Reservations collection |
| `allowGuestBooking` | `boolean` | `false` | Allow bookings without a customer account (per-service override available) |
| `resourceTypes` | `string[]` | `['staff', 'equipment', 'room']` | Option list for `Resource.resourceType`; first entry is the field default. Empty array throws |
| `leaveTypes` | `string[]` | `['vacation', 'sick', 'personal', 'closure', 'other']` | Option list for `Schedule.exceptions[].type`. Empty array throws |
| `resourceOwnerMode` | `ResourceOwnerModeConfig` | `undefined` | Opt-in resource-owner multi-tenancy (see sub-options below) |
| `resourceOwnerMode.adminRoles` | `string[]` | `[]` | Roles that bypass ownership scoping; falls back to admin-collection check |
| `resourceOwnerMode.roleField` | `string` | `staffProvisioning.roleField` ?? `'role'` | User field consulted for admin detection (supports `roles: string[]` fields) |
| `resourceOwnerMode.ownedServices` | `boolean` | `false` | Also add an owner field to Services |
| `resourceOwnerMode.ownerField` | `string` | `'owner'` | Owner relationship field name on Resources |
| `resourceOwnerMode.ownerCollection` | `string` | `staffProvisioning.userCollection` ?? `slugs.customers` | Collection the owner field relates to |
| `staffProvisioning` | `StaffProvisioningConfig` | `undefined` | Opt-in staff auto-provisioning; **requires** `resourceOwnerMode` |
| `staffProvisioning.staffRoles` | `string[]` | — (required, non-empty) | Role value(s) marking a user as staff |
| `staffProvisioning.userCollection` | `string` | top-level `userCollection` | Auth collection holding staff users (required if top-level `userCollection` unset) |
| `staffProvisioning.roleField` | `string` | `'role'` | User field holding the role |
| `staffProvisioning.resourceType` | `string` | `'staff'` | resourceType stamped on the Resource (must be a valid `resourceType`) |
| `staffProvisioning.nameFrom` | `string` | `'name'` | User field copied into `Resource.name` (falls back to email) |
| `staffProvisioning.beforeCreate` | `function` | `undefined` | Stamp tenant/custom fields onto the Resource before create |

> **Vocabularies:** `resourceTypes` (default `['staff', 'equipment', 'room']`) and `leaveTypes` (default `['vacation', 'sick', 'personal', 'closure', 'other']`) customize the option lists for `Resource.resourceType` and `Schedule.exceptions[].type`. See [Staff Scheduling](../README.md#staff-scheduling).

## Internationalization

The plugin's admin strings are translatable and ship in 12 languages. Translations are not a plugin option — they merge into Payload's own `i18n` config (your translations take precedence), so you override strings or add languages through `buildConfig({ i18n })`. See [Internationalization](./i18n.md).

---

← [Getting Started](./getting-started.md) | → [Collections](./collections.md) | ↑ [Back to README](../README.md)

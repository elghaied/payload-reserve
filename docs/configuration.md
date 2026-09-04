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
  // mean, which calendar day a date=YYYY-MM-DD query maps to, and full-day
  // boundaries. Date-only schedule fields (exceptions[].date/endDate,
  // manualSlots[].date) are calendar days keyed by their UTC date and are NOT
  // re-keyed in this zone. Validated at init (invalid name throws).
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

  // Override access control per collection. Each rule replaces the plugin's
  // default for THAT operation only. In standalone mode the defaults already
  // scope customers to their own reservations and their own customer document
  // (see "Access control for customers" below), so opening `create` on
  // customers for self-registration, as here, does not open read/update/delete.
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

  // Resolver folding external busy intervals (calendar sync, legacy booking
  // system, ops tooling, etc.) into availability — see README § External Busy.
  // getExternalBusy: async ({ resourceId, start, end, req }) => [],

  // Replace any of six admin components with your own, without forking the
  // plugin. Each slot takes a Payload component path (string), `false` to opt
  // out, or stays unset to use the plugin's own component — see
  // docs/admin-ui.md § Customising the admin components for the full slot
  // table, the `false`-is-asymmetric note for `reservationDetail`, and a
  // worked example of a replacement `reservationDetail` component.
  components: {
    dashboardWidget: false,
    reservationDetail: '/components/MyReservationDetail.tsx#MyReservationDetail',
  },
})
```

> **`staffProvisioning` requires `resourceOwnerMode`.** Configuring `staffProvisioning` without `resourceOwnerMode` throws at init. `staffProvisioning.staffRoles` must be a non-empty array, and `staffProvisioning.userCollection` is required when the top-level `userCollection` is unset. The provisioned Resource is created by impersonating the staff user (so `owner` is always that user), is idempotent (deduped by owner), is non-blocking (failures are logged, not thrown), and is never auto-deleted on demotion.

## Defaults Table

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable plugin behavior. Collections still register (schema stays stable), but collection hooks are stripped and endpoints/admin/provisioning are skipped; an invalid sub-config no longer throws at boot |
| `timezone` | `string` | `'UTC'` | IANA timezone governing schedule resolution, day boundaries, and full-day windows. Date-only schedule fields (`exceptions[].date`/`endDate`, `manualSlots[].date`) name a calendar day by their UTC date, independent of this option. Invalid name throws at init |
| `adminGroup` | `string` | `'Reservations'` | Admin panel group label |
| `defaultBufferTime` | `number` | `0` | Default buffer between bookings (minutes) |
| `enforceActive` | `boolean` | `true` | Reject creating a reservation against an inactive service or resource (or an `items[]` entry referencing one), and reject an update that newly references an inactive one or reschedules onto one; exclude inactive services/resources from availability. Any change to `startTime`, `endTime`, `service`, `resource`, `items`, or `guestCount` re-checks every reference. Edits that touch none of those — confirming, cancelling, editing notes — are always allowed, so an existing booking never becomes stranded when its service or resource is deactivated later. Set `false` to restore the previous behaviour, where `active` was advisory only and had no effect on booking or availability |
| `debug` | `boolean` | `false` | Emit info-level `reserve_debug` traces (one Pino event, a `stage` field, a per-call `traceId`) for slot generation and conflict detection — every `getAvailableSlots`/`checkAvailability` empty-return reason, per-stage candidate counts, endpoint request/response, write-path conflict decisions, and previously-swallowed `bufferFor`/`getExternalBusy` errors. Emits at `info` (not `debug`) so lines survive Pino's default production level. No output when false |
| `cancellationNoticePeriod` | `number` | `24` | Minimum hours notice for cancellation |
| `userCollection` | `string` | `undefined` | Existing auth collection slug to extend. Leaves Reservations on Payload's default access — supply `access.reservations` if customers log in there (see [Access control for customers](#access-control-for-customers)) |
| `access` | `Record<collection, CollectionConfig['access']>` | `{}` | Per-collection, per-operation access overrides. A rule you supply replaces the plugin's default for that operation only |
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
| `calendar` | `ReservationCalendarConfig` | `undefined` | Calendar presentation: hidden view tabs and per-status colour overrides (see sub-options) |
| `calendar.hiddenViews` | `ReservationCalendarViewMode[]` (`'day' \| 'lanes' \| 'month' \| 'pending' \| 'week'`) | `undefined` | View **tabs** to hide from the calendar toolbar. This hides navigation only — it never touches a status. Hiding the `pending` tab still leaves the `pending` *status* with its colour on events and its legend entry. The toolbar never goes empty: hiding every tab falls back to showing `month` |
| `calendar.statusPresentation` | `Partial<Record<string, StatusPresentation>>` | `undefined` | Per-status colour overrides, keyed by status value. `background`/`foreground` are plain CSS colour strings applied inline (not classes), so `var(--token)` works and the consumer can keep light/dark theming in its own stylesheet |
| `multiTenant` | `object` | `undefined` | Opt-in tenant scoping for the custom admin views and the reservation customer-search endpoint; scopes/zones only when the collection actually has the tenant field (see sub-options) |
| `multiTenant.tenantField` | `string` | `'tenant'` | Tenant relationship field name on scoped collections |
| `multiTenant.cookieName` | `string` | `'payload-tenant'` | Cookie the tenant selector writes the active tenant id to |
| `multiTenant.timezoneField` | `string` | `'timezone'` | Field on the tenant document holding its IANA timezone. Admin day-boundaries resolve `tenant.<timezoneField> → global timezone → 'UTC'`; a missing/invalid value falls back to the global `timezone` |
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
| `getExternalBusy` | `GetExternalBusy` | `undefined` | Resolver folding external busy intervals (calendar sync etc.) into availability — see README § External Busy |
| `components` | `ReservationComponentOverrides` | `{}` | Per-slot overrides for six admin components (`calendarView`, `customerField`, `availabilityTimeField`, `dashboardWidget`, `availabilityOverview`, `reservationDetail`). Each slot is a Payload component path string, `false` to opt out, or unset for the plugin's own component. `false` is asymmetric — it falls back to a genuine Payload default for five slots, but restores only the pre-feature *click* behaviour for `reservationDetail`, which has no Payload default. Setting any slot to a string requires running `payload generate:importmap` afterward. See [Admin UI → Customising the admin components](./admin-ui.md#customising-the-admin-components) |

> **Vocabularies:** `resourceTypes` (default `['staff', 'equipment', 'room']`) and `leaveTypes` (default `['vacation', 'sick', 'personal', 'closure', 'other']`) customize the option lists for `Resource.resourceType` and `Schedule.exceptions[].type`. See [Staff Scheduling](../README.md#staff-scheduling).

## Access control for customers

Payload's built-in default for a collection with no access rules is `Boolean(user)` on every operation: any authenticated user, from any auth collection, may read, update and delete every document. For a booking system where customers hold logins, that default is a vulnerability, and until 4.1.1 the plugin shipped it (reported privately by an external researcher — see the 4.1.1 changelog).

### Standalone mode (default) — scoped out of the box

With no `userCollection`, "staff/admin" is any user of an auth collection other than the generated customers one, so the plugin can scope customers exactly:

| Collection | `read` | `update` | `delete` | `create` |
|------------|--------|----------|----------|----------|
| Reservations | staff: all; customer: `customer equals req.user.id` | same as read; `customer` cannot be re-assigned by a customer | staff only | Payload default (any authenticated user); `enforceCustomerOwnership` pins `customer` to the caller |
| Customers | staff: all; customer: own document only | same as read; the `notes` field is additionally staff-only at field level | staff only | Payload default — set `create: () => true` to allow self-registration |

Nothing to configure. Anything you pass in `access.reservations` / `access.customers` replaces the default for that operation only, so `customers: { create: () => true }` opens registration without reopening reads.

### `userCollection` mode — you supply the rule

When staff and customers share one auth collection, the plugin cannot tell them apart without a role, so Reservations stays on Payload's default and the plugin logs a warning at boot whenever `userCollection` is set with no `access.reservations.read` and no `resourceOwnerMode`. If **only staff** can log in to that collection, ignore the warning. If **customers** can, scope them yourself — the pattern the plugin uses in standalone mode, keyed on your role field:

```typescript
import type { Access } from 'payload'

const isStaff = (user: { role?: string } | null | undefined) =>
  user?.role === 'admin' || user?.role === 'staff'

const ownOrStaff: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isStaff(user)) return true
  return { customer: { equals: user.id } }
}

payloadReserve({
  userCollection: 'users',
  access: {
    reservations: {
      read: ownOrStaff,
      update: ownOrStaff,
      delete: ({ req: { user } }) => isStaff(user),
    },
  },
})
```

Your `users` collection's own `access` governs who can read or update other users (and their passwords) — the plugin never changes it. `resourceOwnerMode` brings its own reservation rules (admin-only mutations, owners read their resources' reservations) and does not need this.

## Internationalization

The plugin's admin strings are translatable and ship in 12 languages. Translations are not a plugin option — they merge into Payload's own `i18n` config (your translations take precedence), so you override strings or add languages through `buildConfig({ i18n })`. See [Internationalization](./i18n.md).

---

← [Getting Started](./getting-started.md) | → [Collections](./collections.md) | ↑ [Back to README](../README.md)

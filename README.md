# payload-reserve

[![npm version](https://img.shields.io/npm/v/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![npm downloads](https://img.shields.io/npm/dm/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![license](https://img.shields.io/npm/l/payload-reserve.svg)](./LICENSE)

A full-featured reservation and booking plugin for Payload CMS 3.x. Adds a scheduling system with conflict detection, a configurable status machine, multi-resource bookings, capacity and inventory tracking, a public REST API, and admin UI components.

Designed for salons, clinics, hotels, restaurants, event venues, and any business that needs appointment scheduling managed through Payload's admin panel.

📦 **npm:** https://www.npmjs.com/package/payload-reserve

---

## Features

- **5 Domain Collections** — Services, Resources, Schedules, Reservations, and Customers (standalone or user-collection extension)
- **User Collection Extension** — Optionally extend your existing auth collection with booking fields; set `userCollection: undefined` (default) to use a standalone Customers collection
- **Resource Owner Multi-Tenancy** — Opt-in `resourceOwnerMode` wires ownership access control so each resource owner (host) sees only their own listings and reservations
- **Configurable Status Machine** — Define your own statuses, transitions, blocking states, terminal states, and the `confirmStatus`/`cancelStatus` that drive the confirm/cancel hooks and cancellation policy
- **Double-Booking Prevention** — Server-side conflict detection that enforces both bookings' buffer times and checks each resource only for its own item window; respects capacity modes
- **Business Timezone** — Set a plugin-level `timezone` (IANA, default `'UTC'`) so schedules, day boundaries, and the admin calendar resolve in your business's timezone regardless of server location — with optional **per-tenant** zones in `multiTenant` mode
- **Auto End Time** — Calculates `endTime` from `startTime + service.duration` automatically for `fixed`/`full-day` services; the `endTime` field stays editable so `flexible`-duration bookings can supply their own end time
- **Three Duration Types** — `fixed` (service duration), `flexible` (customer-specified end), and `full-day` bookings
- **Multi-Resource Bookings** — Single reservation that spans multiple resources simultaneously via the `items` array
- **Capacity and Inventory** — `quantity > 1` allows multiple concurrent bookings per resource; `capacityMode` (`per-reservation` | `per-guest`) controls how capacity is counted
- **Guest Bookings** — Account-less reservations with inline contact details (name + email/phone); `allowGuestBooking` plugin option and per-service `inherit`/`enabled`/`disabled` override; guests receive a `cancellationToken` via the `afterBookingCreate` hook for cancel-link delivery
- **Idempotency** — Optional `idempotencyKey` prevents duplicate submissions
- **Collection Overrides** — Customize any generated collection (add fields like a `join`, tweak admin options, attach your own hooks) via `collectionOverrides` without forking — the plugin's hooks and access are merged, not clobbered (supersedes the deprecated `extraReservationFields`)
- **Services ↔ Resources Join** — Services show a read-only `resources` field (a `join` over `Resources.services`) listing which resources currently perform them; assignment still happens on the Resource
- **Active Enforcement** — `active: false` on a Service or Resource — including one referenced by a multi-resource `items[]` entry — now blocks new/changed bookings against it and excludes it from availability; opt out with `enforceActive: false`
- **Cancellation Policy** — Configurable minimum notice period enforcement
- **Plugin Hooks API** — Seven lifecycle hooks (`beforeBookingCreate`, `afterBookingCreate`, `beforeBookingConfirm`, `afterBookingConfirm`, `beforeBookingCancel`, `afterBookingCancel`, `afterStatusChange`) for integrating email, Stripe, and external systems
- **Availability Service** — Pure functions and DB helpers for slot generation (15-min step) and conflict checking with guest-count-aware filtering
- **Public REST API** — Six pre-built endpoints for availability, slot listing, resource availability, booking (incl. guest bookings), cancellation, and customer search — with ownership enforcement and input validation
- **Calendar View** — Month/week/day/lanes/pending calendar replacing the default reservations list view, with per-resource availability shading and click-a-free-slot-to-book; plus an availability-aware slot picker on the reservation form
- **Dashboard Widget** — Server component showing today's booking stats
- **Availability Overview** — Weekly grid of resource availability vs. booked slots
- **Recurring and Manual Schedules** — Weekly patterns with exception dates, or specific one-off dates
- **12 Bundled Languages** — Every admin string is translatable; ships with English, French, German, Spanish, Russian, Polish, Turkish, Arabic, Simplified Chinese, Indonesian, Persian/Farsi, and Hindi. Override any string or add your own language
- **Localization Support** — Collection field *content* can be localized when Payload localization is enabled (separate from the admin-UI language above)
- **External Busy** — Optional `getExternalBusy` resolver folds busy time from calendar sync, legacy booking systems, or ops tooling into availability, with distinct calendar display and fail-open error handling
- **Debug Tracing** — Opt-in `debug` (`boolean`, default `false`) emits info-level `reserve_debug` traces for slot generation and conflict detection. Each line has a `stage` field and a per-call `traceId`; grep one `traceId` to see the whole story of one availability call. Off by default, no overhead when disabled
- **Type-Safe** — Full TypeScript support with exported types

---

## Install

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependencies:** `payload ^3.86.0`, `@payloadcms/ui ^3.86.0`, `@payloadcms/translations ^3.86.0`

---

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [/* your collections */],
  plugins: [
    payloadReserve(),
  ],
})
```

---

## Resource Owner Multi-Tenancy

Enable `resourceOwnerMode` to support Airbnb-style platforms where each user manages their own listings (Resources) and sees only the reservations made against them. This is opt-in — single-tenant installs are unaffected.

```typescript
payloadReserve({
  userCollection: 'users',       // required: which auth collection holds owners
  resourceOwnerMode: {
    adminRoles: ['admin'],        // roles that bypass all filters (see all records)
    ownerField: 'owner',          // field name added to Resources (default: 'owner')
    ownedServices: false,         // set true if Services should also be owner-scoped
  },
})
```

**What this does automatically:**

| Collection | Behaviour |
|------------|-----------|
| Resources | Adds an `owner` relationship field (auto-populated on create); owners read/update/delete only their own records |
| Schedules | Owners read/update/delete only schedules whose resource they own (join through `resource.owner`) |
| Reservations | Owners can read reservations for their resources; mutations are admin-only |
| Services | Unchanged by default; set `ownedServices: true` to apply the same owner pattern |

The `access` override in plugin config always takes precedence over the auto-wired functions, so you can fine-tune any collection without losing the rest.

---

## Guest Bookings

Enable `allowGuestBooking` to accept reservations from users who don't have a customer account. Guests provide inline contact details (name + email or phone) instead of linking to a customer record.

```typescript
payloadReserve({
  allowGuestBooking: true,   // enable guest bookings globally (default: false)
})
```

### Per-service override

Each Service has its own `allowGuestBooking` select field that overrides the plugin-level default:

| Value | Behaviour |
|-------|-----------|
| `inherit` | Use the plugin-level `allowGuestBooking` value *(default)* |
| `enabled` | Allow guest bookings for this service regardless of the global setting |
| `disabled` | Require a customer account for this service regardless of the global setting |

> **Note:** For multi-resource bookings (the `items` array), the guest-booking gate is evaluated against the reservation's top-level `service`. Per-item service overrides are not individually enforced.

### Customer vs. guest

The `customer` relationship field on Reservations is now **optional**. A reservation must have **either** a `customer` **or** a `guest` block — not both, not neither.

The `guest` block requires `name` and at least one of `email` or `phone`:

```typescript
// POST /api/reserve/book
{
  "service": "...",
  "resource": "...",
  "startTime": "2026-06-01T10:00:00.000Z",
  "guest": {
    "name": "Jane Smith",
    "email": "jane@example.com"   // or "phone": "+1-555-0100"
  }
}
```

### Cancellation token

When a guest booking is created the plugin generates a `cancellationToken` (random UUID). It is **not** returned in the `/api/reserve/book` HTTP response. It is exposed server-side via the `afterBookingCreate` plugin hook so the host project can deliver a cancel link by email or an SMS code:

```typescript
payloadReserve({
  allowGuestBooking: true,
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        if (doc.guest && doc.cancellationToken) {
          // Send the token however you like — the plugin sends nothing itself
          await sendEmail({
            to: doc.guest.email,
            cancelUrl: `https://example.com/cancel?reservationId=${doc.id}&token=${doc.cancellationToken}`,
          })
        }
      },
    ],
  },
})
```

To cancel with the token, POST to `/api/reserve/cancel` without authentication:

```typescript
// POST /api/reserve/cancel
{
  "reservationId": "...",
  "token": "<cancellationToken>"
}
```

Authenticated owner/admin cancellation (without a token) is unchanged.

## Staff Scheduling

### Staff Auto-Provisioning

Enable `staffProvisioning` to automatically create an owner-scoped Resource whenever a user gains a staff role. Requires `resourceOwnerMode`.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'],
  },
  staffProvisioning: {
    staffRoles: ['staff', 'therapist'],  // roles that trigger auto-provisioning
    roleField: 'role',                   // field on the user doc (default: 'role')
    resourceType: 'staff',               // resourceType stamped on the new Resource (default: 'staff')
    nameFrom: 'name',                    // user field to use as Resource name (default: 'name', falls back to email)
  },
})
```

**Use `beforeCreate` to stamp tenant IDs or custom fields** before the Resource is saved:

```typescript
staffProvisioning: {
  staffRoles: ['staff'],
  beforeCreate: ({ data, user }) => ({
    ...data,
    tenant: user.tenant,   // forward the user's tenant to the new Resource
  }),
},
```

**Key behaviours:**

- **Idempotent** — deduplicates by owner; creating or re-saving a staff user never creates a second Resource.
- **Non-blocking** — provisioning failures are logged and do not prevent user creation or update.
- **Impersonation-based ownership** — the Resource is created as the new staff user, so `resource.owner` is always the user themselves (no ownership-bypass flag).
- **No auto-delete on demotion** — removing a staff role from a user does not delete their Resource.

### Full-Day-Range Time-Off

Schedule exceptions now support a date range and a leave type:

```typescript
// Schedule.exceptions[] — each entry can have:
{
  date: '2025-12-25',   // start date (always required)
  endDate: '2025-12-26', // optional range end, inclusive
  type: 'vacation',      // optional leave category
}
```

Any date falling within the range (inclusive) makes the resource fully unavailable for that day. This powers multi-day leave entries for staff schedules.

### Configurable Vocabularies

Customize the option lists for resource types and leave types:

```typescript
payloadReserve({
  resourceTypes: ['staff', 'room', 'equipment', 'vehicle'],  // default: ['staff','equipment','room']
  leaveTypes: ['vacation', 'sick', 'training', 'closure'],   // default: ['vacation','sick','personal','closure','other']
})
```

The first entry of `resourceTypes` becomes the default value for the `Resource.resourceType` field.

### Business Timezone

Set a plugin-level `timezone` (IANA name, default `'UTC'`) to govern all schedule resolution — what `HH:mm` schedule times mean, which calendar day a `date=YYYY-MM-DD` query maps to, exception-day matching, and full-day booking boundaries:

```typescript
payloadReserve({
  timezone: 'America/New_York',  // default: 'UTC'
})
```

Without this, day resolution mixes server-local and UTC semantics — on non-UTC servers the slots API can resolve the wrong calendar day. With `timezone` set, all server-side day math runs via the built-in `Intl` API (no extra dependency). `'UTC'` on a UTC server is identical to the previous behaviour. The configured timezone is exposed to admin components via `config.admin.custom.reservationTimezone`.

#### Per-tenant timezones (`multiTenant`)

When tenant scoping is active, the admin Calendar, Availability grid, and Dashboard widget resolve day-boundaries in the **selected tenant's** zone instead of one global zone — so a tenant in `America/New_York` and a tenant in `Europe/Paris` each see their own local days. Point `multiTenant.timezoneField` at the IANA timezone field on your tenant document:

```typescript
payloadReserve({
  timezone: 'UTC',                          // global default / fallback
  multiTenant: {
    timezoneField: 'timezone',              // field on the tenant doc (default: 'timezone')
  },
})
```

Resolution precedence is `tenant.<timezoneField> → global timezone → 'UTC'`; a tenant with no (or an invalid) timezone value transparently falls back to the global default. The zone is resolved server-side from the tenant cookie — the client calendar reads it from `GET /api/reserve/effective-timezone`. This is purely additive: plain single-tenant installs (no tenant relationship / no tenant cookie) keep the global zone with no extra DB read.

#### Tenant-scoped customer search

The reservation form's customer picker (and its backing `/api/reservation-customer-search` endpoint) restricts results to the **selected tenant** — read from the tenant cookie — whenever the customers collection carries the multi-tenant `tenant` field. This prevents picking a customer from another tenant (which would otherwise fail on save with a tenant mismatch). Like the per-tenant timezone behaviour, it is purely additive: plain single-tenant installs (customers collection without a tenant field, or no tenant cookie) are unaffected and the search spans all customers as before.

```typescript
payloadReserve({
  multiTenant: {
    tenantField: 'tenant',        // tenant relationship field on collections (default: 'tenant')
    cookieName: 'payload-tenant',  // selected-tenant cookie (default: 'payload-tenant')
  },
})
```

### Collection Overrides

Customize any generated collection without forking the plugin via `collectionOverrides`. Each entry is a `Partial<CollectionConfig>` (minus `fields`/`slug`) plus a `fields` function that receives the plugin's default fields:

```typescript
payloadReserve({
  collectionOverrides: {
    services: {
      // Generic illustration of appending a field via collectionOverrides — not
      // the way to get a services↔resources view: Services already ships that
      // built in as a read-only `resources` join (see below). Don't name your
      // own appended field `resources` on `services`, or it collides with it.
      fields: ({ defaultFields }) => [
        ...defaultFields,
        { name: 'referencedResources', type: 'join', collection: 'resources', on: 'services' },
      ],
    },
    reservations: {
      admin: { group: 'Bookings' },               // shallow-merged
      hooks: { afterChange: [sendConfirmationEmail] }, // MERGED with the plugin's hooks
    },
  },
})
```

The plugin's load-bearing behavior is protected: supplied `hooks` are **merged** (the plugin's conflict-detection/status hooks always run, and run first — an override can add hooks but not remove them), `access` **composes** per operation (rules you omit keep the plugin's owner-mode/default behavior), and `slug` is ignored (use the `slugs` option). The `customers` override applies only when the standalone Customers collection is generated (ignored when `userCollection` is set — your auth collection is yours to edit directly). `collectionOverrides` supersedes the deprecated `extraReservationFields`.

> **Note:** a `collectionOverrides.resources` override that removes, renames, or nests the `services` field inside a *named* group or tab causes the Services `resources` join (below) to be silently skipped rather than erroring — the app still boots, the field simply doesn't appear.

### Optional `Resource.services`

The `services` relationship on Resources is now optional. This lets a freshly provisioned staff Resource exist before services are assigned, avoiding validation errors during auto-provisioning.

### Services `resources` Join

Services expose a read-only `resources` field — a Payload `join` over `Resources.services` — listing which resources currently perform that service. `Resources.services` remains the single source of truth and the only editable side: assign or remove services from the **Resource**, and the reverse list on the Service updates automatically. There is no way to add or remove a link from the Service side.

Reading (or viewing in the admin) a Service returns the join in Payload's standard join-field shape:

```json
{
  "resources": {
    "docs": [{ "id": "...", "name": "...", "resourceType": "staff", "active": true }],
    "hasNextPage": false,
    "totalDocs": 3
  }
}
```

- **`defaultLimit: 100`** — raised from Payload's default of 10, so a service performed by more than 10 resources doesn't silently show a truncated list.
- **`allowCreate: false`** — the join can only ever create a *brand-new* Resource from the drawer, never link an existing one, and the Resource's `services` field is `hasMany` while the join's create-drawer pre-fill is scalar — so the affordance is disabled. Assign resources on the Resource itself.
- **`defaultColumns: ['name', 'resourceType', 'active']`** — the `active` column lets an admin see at a glance that a linked resource is disabled.

If a `collectionOverrides.resources` override removes, renames, or nests `services` inside a *named* group/tab, the join is gated off entirely (see the note above) rather than crashing the app at init.

#### `joins: false` on hot paths

Payload join fields resolve via a DB-level aggregation (`$lookup`) and ignore `depth`, so every internal `findByID` the plugin makes on Services now passes `joins: false` to avoid that extra query cost. If your own code reads Services on a hot path, consider doing the same — `payload.findByID({ collection: 'services', id, joins: false })`.

---

## External Busy (Calendar Sync & Other Sources)

`getExternalBusy` lets your app fold busy time that payload-reserve doesn't manage — an external calendar, a legacy booking system, ops tooling — into a resource's availability. The plugin never talks to any calendar API itself; it calls a resolver you provide once per candidate window and treats whatever it returns as busy time for that resource.

Use it to:

- Import busy time from two-way calendar sync (Google Calendar, Outlook, iCal feeds)
- Respect bookings made in another/legacy booking system during a migration
- Block maintenance/cleaning windows tracked in an ops system
- Reflect staff leave recorded in an HR system that isn't modeled as plugin time-off

A realistic setup keeps a local collection in sync (via webhooks or a cron job) and has the resolver run a single indexed query against it — the resolver itself never calls a remote API:

```ts
import type { ExternalBusyInterval, GetExternalBusy } from 'payload-reserve'

// A sync job (webhook handler or scheduled cron task) keeps this collection's
// rows current from whatever external source you're integrating — a
// Google/Outlook calendar sync, a legacy system export, an ops tool, etc.
// The resolver below never calls out itself; it only reads what the sync
// job already wrote, so it stays a single cheap, indexed query.
const getExternalBusy: GetExternalBusy = async ({ end, req, resourceId, start }) => {
  const result = await req.payload.find({
    collection: 'external-busy', // your locally-synced collection
    where: {
      and: [
        { resource: { equals: resourceId } },
        { start: { less_than: end.toISOString() } },
        { end: { greater_than: start.toISOString() } },
      ],
    },
    depth: 0,
    limit: 0,
  })

  return result.docs.map(
    (doc): ExternalBusyInterval => ({
      start: doc.start,
      end: doc.end,
      label: doc.label,
    }),
  )
}

payloadReserve({
  getExternalBusy,
})
```

- **Enforcement:** any booking (hooks, endpoints, slot listings) overlapping an interval is unavailable. An interval blocks the WHOLE resource (all `quantity` units) — external calendars aren't unit-aware.
- **Display:** the `resource-availability` endpoint returns the intervals as a separate `external[]` array (not mixed into `busy`), and the calendar renders them as a distinct, non-clickable hatched "External event" slot.
- **Fail-open:** if the resolver throws, the plugin treats it as no external busy for that call — a sync failure never blocks a real booking or breaks the grid.
- **Performance:** the resolver is called once per candidate window during slot computation, so keep it cheap — a local table lookup or a per-request cache, never a remote API call per invocation.

---

## Internationalization

Every admin string the plugin renders — field labels, descriptions, select options, calendar/dashboard components, and validation errors — is translatable. The plugin ships **12 languages**: English, French (`fr`), German (`de`), Spanish (`es`), Russian (`ru`), Polish (`pl`), Turkish (`tr`), Arabic (`ar`), Simplified Chinese (`zh`), Indonesian (`id`), Persian/Farsi (`fa`), and Hindi (`hi`). All but Hindi ship in Payload core and appear in the admin language switcher automatically.

Translations merge into your config and **your translations take precedence**, so you can override any string or add a language:

```typescript
payloadReserve()
// and in buildConfig:
i18n: {
  translations: {
    en: { reservation: { calendarLanes: 'Timeline' } }, // override a plugin string
  },
}
```

> **Hindi** (`hi`) is not bundled by Payload core, so register it as a custom language in your Payload `i18n` config to make it selectable — the plugin's `hi` strings then appear automatically. See the [Internationalization docs](https://github.com/elghaied/payload-reserve/blob/main/docs/i18n.md).

This is separate from Payload **field localization** (localizing the *content* of fields), which the plugin's fields also support when Payload localization is enabled.

---

## Documentation

> The docs below live in the [GitHub repository](https://github.com/elghaied/payload-reserve/tree/main/docs) and are not included in the published npm package.

| Topic | Contents |
|-------|----------|
| [Getting Started](https://github.com/elghaied/payload-reserve/blob/main/docs/getting-started.md) | Installation, quick start, what gets created |
| [Configuration](https://github.com/elghaied/payload-reserve/blob/main/docs/configuration.md) | All plugin options with types and defaults, including `resourceOwnerMode` and `getExternalBusy` |
| [Collections](https://github.com/elghaied/payload-reserve/blob/main/docs/collections.md) | Services, Resources, Schedules, Customers, Reservations schemas |
| [Status Machine](https://github.com/elghaied/payload-reserve/blob/main/docs/status-machine.md) | Default flow, custom machines, business logic hooks, escape hatch |
| [Booking Features](https://github.com/elghaied/payload-reserve/blob/main/docs/booking-features.md) | Duration types, multi-resource bookings, capacity modes |
| [Hooks API](https://github.com/elghaied/payload-reserve/blob/main/docs/hooks-api.md) | All 7 plugin hook types with signatures and examples |
| [REST API](https://github.com/elghaied/payload-reserve/blob/main/docs/rest-api.md) | All 6 public endpoints with params, responses, and fetch examples |
| [Admin UI](https://github.com/elghaied/payload-reserve/blob/main/docs/admin-ui.md) | Calendar view, dashboard widget, availability overview |
| [Internationalization](https://github.com/elghaied/payload-reserve/blob/main/docs/i18n.md) | 12 bundled languages, overriding strings, adding a language, Hindi setup |
| [Examples](https://github.com/elghaied/payload-reserve/blob/main/docs/examples.md) | Salon, hotel, restaurant, event venue, Stripe, email, multi-tenant (resource owner mode) |
| [Advanced](https://github.com/elghaied/payload-reserve/blob/main/docs/advanced.md) | DB indexes, reconciliation job for race condition detection |
| [Development](https://github.com/elghaied/payload-reserve/blob/main/docs/development.md) | Prerequisites, commands, project file tree |
| [v1.2.0 Breaking Changes](https://github.com/elghaied/payload-reserve/blob/main/docs/BREAKING-CHANGES-v1.2.md) | Migration guide for upgrading to v1.2.0 |

---

## Contributing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

When making a change that should appear in the release notes, run:

```bash
pnpm changeset
```

This prompts for the semver bump type (patch/minor/major) and a summary. Commit the generated changeset file with your PR.

**Releasing:**

```bash
pnpm changeset:version   # consume changesets, bump version, update CHANGELOG.md
git add -A && git commit -m "release v<version>"
git tag v<version>
git push && git push --tags
```

The GitHub Action will create a release with the changelog content and publish to npm.

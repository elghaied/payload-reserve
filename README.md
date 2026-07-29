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
- **Active Enforcement** — `active: false` on a Service or Resource — including one referenced by a multi-resource `items[]` entry — blocks new bookings against it, blocks rescheduling or re-pointing an existing booking onto it, and excludes it from availability; non-scheduling edits such as confirm and cancel always remain allowed, and `enforceActive: false` opts out entirely
- **Concurrency-Safe Booking** — A transactional `bookingLock` on Resources serializes simultaneous bookers for the same slot; automatic retry recovers lost capacity on MongoDB, and a surviving conflict maps to a clean HTTP 409 rather than a raw 500 — see [Concurrent booking: database adapter support](#concurrent-booking-database-adapter-support)
- **Slot Holds** — Opt-in short-lived claims on a slot while a customer completes checkout, so it can't be booked out from under them; convert to a real booking or release, both idempotent-safe
- **Delete Guard** — Deleting a Service or Resource still referenced by a reservation (or, for a Resource, a schedule) fails with an actionable message instead of an inconsistent database or a silent dangling reference; `active: false` is the supported way to retire one
- **Cancellation Policy** — Configurable minimum notice period enforcement
- **Plugin Hooks API** — Seven lifecycle hooks (`beforeBookingCreate`, `afterBookingCreate`, `beforeBookingConfirm`, `afterBookingConfirm`, `beforeBookingCancel`, `afterBookingCancel`, `afterStatusChange`) for integrating email, Stripe, and external systems — all fire inside the write's own database transaction, never after
- **Availability Service** — Pure functions and DB helpers for slot generation (15-min step) and conflict checking with guest-count-aware filtering
- **Public REST API** — Seven pre-built endpoints for availability, slot listing, resource availability, booking (incl. guest bookings), cancellation, and customer search, plus two more for slot holds when enabled — with ownership enforcement and input validation
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

> **Using SQLite?** It requires one extra adapter setting to avoid silent double-booking under concurrent load — see [Concurrent booking: database adapter support](#concurrent-booking-database-adapter-support).

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

One path still pays for the join: when a Reservation is read at `depth >= 1`, Payload populates its `service` relationship through the internal dataloader, which offers no `joins: false` seam from plugin code. If that shows up in your profiles, read Reservations with `depth: 0` and fetch the service yourself.

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

## Access Control & Booking Correctness

### Endpoints enforce collection access control

Four endpoints now gate the request through Payload's normal access-control pipeline (`overrideAccess: false` + `req`) instead of reading privileged. The governing rule is **gate the request with one explicit access-checked call, then keep the derived reads privileged** — an endpoint authorizes *what you asked for*, and once you are past that gate it still assembles a complete answer. So this is deliberately a per-path change, not a blanket flip:

| Endpoint | What delegates to access control | What stays privileged | Why |
|---|---|---|---|
| `/api/reservation-customer-search` | the customer query itself | — | The whole endpoint is the read; nothing is derived from it. |
| `/api/reserve/resource-availability` | a `findByID` probe of the requested resource (404 on denial) | every read that builds the grid: the resource itself, its schedules, its busy reservations, and — only when `slotHolds` is enabled — its unexpired slot holds. So **four** reads for a plain resource with `slotHolds` on, three with it off. Each `requiredResources` pool its services name adds three more (the pool's own resource read, its busy reservations, its holds), or two with `slotHolds` off. Two are Resources reads, and there is no separate services read | The probe decides *whether you may see this resource*. The grid must then show every conflicting booking, including other tenants' and other owners' — a busy slot you can't see is a double-booking. |
| `/api/reserve/cancel` | the update, **only** on the privileged-non-owner path | the reservation read, and the update on the owner and guest-token paths | For a guest the cancellation token *is* the authorization. For an owner, `resourceOwnerMode`'s `update: adminOnly` would otherwise block a customer cancelling their own booking. Ownership and token matching are checked in the endpoint before either path is taken. |
| `/api/reserve/effective-timezone` | the tenant-document read (falls back to the global zone on denial) | — | Prevents a forged tenant cookie resolving a zone you have no membership in. |

- **Plain installs** (no `resourceOwnerMode`, no `multiTenant`, and no custom `access` overrides) are unaffected: Payload's own built-in default is `read: ({ req: { user } }) => Boolean(user)`, so any authenticated user still passes.
- **A `userCollection` with a restrictive `read` rule now narrows customer search accordingly.** If the existing auth collection you pointed `userCollection` at defines its own `access.read` — for example, one that scopes a user to their own record or to a department — `/api/reservation-customer-search` now respects it, because the endpoint no longer out-permissions the collection it reads from. If staff stop seeing customers they used to see, the fix is in that collection's own `access.read`, not in the plugin.

#### `/api/reserve/book`: the tenant probe is the gate, not `overrideAccess`

`POST /api/reserve/book` does **not** follow the single "gate with one access-checked call" pattern the table above uses. Its write stays **privileged for every caller** (`overrideAccess: true` — the Local API default this endpoint has always used), and a separate access-checked probe is what authorizes the tenant. Both halves of that are deliberate:

1. **`overrideAccess: false` cannot gate this write, so it is not used to pretend otherwise.** Payload's `create` access check (`executeAccess`) only tests the *truthiness* of what an access function returns and — unlike read/update/delete — never applies a returned `Where`, because there is no existing document to filter. Multi-tenant scopes access precisely by returning a `Where`, so its tenant-scoped `create` access passes for *any* authenticated member of *any* tenant no matter how this flag is set. Delegating would therefore add no isolation while actively breaking real callers: `resourceOwnerMode` makes reservation `create` **admin-only** (`makeReservationOwnerAccess`), so both an ordinary customer booking for themselves *and* a non-admin staff or resource-owner account booking a walk-in would get a flat `403` from an endpoint that served them in every earlier release.
2. **`callerMayUseTenant` (which tenant they may write into) is the gate.** For every authenticated caller, an access-checked (`overrideAccess: false`) probe read (`src/utilities/tenantTimezone.ts`) checks any explicit `tenant` in the request body against the tenants collection, and a denial returns a clean `403` before `payload.create` is ever called. This is what **closes** the formerly-open hole where an authenticated tenant-A caller could `POST` an explicit `tenant: <tenant-B-id>` and land the reservation there. A `hasMany` tenant field is supported: every id in the array is probed.

Who may book for whom is enforced separately and independently of either of the above: an authenticated non-privileged caller is forced onto their own customer id, and an anonymous caller may not name an existing customer at all (the guest flow covers them).

**Precondition worth knowing:** the probe is a genuine membership check only when the caller authenticates against the *same* collection multi-tenant wraps as its admin/tenant-owning collection — true whenever `userCollection` points at that collection. In **standalone mode** (no `userCollection`), customers authenticate against the plugin's own `slugs.customers`, a collection multi-tenant never wraps, so the probe passes for any tenant id supplied by a logged-in customer. The plugin warns about this at boot whenever standalone mode + multi-tenant is detected; the fix is `userCollection` pointing at multi-tenant's admin auth collection, or your own tenant check in front of the endpoint.

**Consequence to know about, by design, not an oversight:** because the write is privileged, a consumer's own `access.reservations.create` — and any field-level `create` access added via `collectionOverrides.reservations` — is **not** applied to bookings made through this endpoint. That is unchanged from every release before tenant scoping existed, and nothing about it is exploitable (who may book for whom is enforced in the endpoint itself, and the tenant is probed). But if you add create access via `collectionOverrides` expecting it to run for every booking, it will not run for this one — put the rule in a `beforeChange` hook (which does run) or in the `hooks.beforeBookingCreate` plugin hook instead.

The reservations collection's own REST API (`POST /api/reservations`) is unaffected — it goes through Payload's access control as normal.

### `resourceOwnerMode`: the availability grid now matches the Resources collection

Under `resourceOwnerMode`, a staff user (a role listed in `staffRoles` but **not** in `adminRoles`) can now only pull `/api/reserve/resource-availability` for their **own** resource — the same restriction the Resources collection already applies to ordinary reads. Add the role to `adminRoles` to restore the wider (all-resources) view for that user.

### Multi-resource conflict detection now covers the top-level `resource`

A booking's top-level `resource` field is now conflict-checked even when the request also supplies an explicit `items[]` that never names it. Previously, a caller could put resource A in the top-level fields and only *other* resources in `items[]`, and A itself was never checked for overlaps — even though every other booking's conflict check already treats A as occupied by this one. Overlaps against the top-level resource that were previously accepted are now rejected.

If you call `resolveReservationItems` directly (it's exported from the package root), note that its returned array can now contain one more entry than before — one synthesized from the top-level `resource`/`startTime`/`endTime` and flagged `fromParent: true` — unless an `items[]` entry for that same resource already, demonstrably, covers the same window.

### Calendar clicks and slot windows resolve in the business timezone

The admin Calendar's grid instants, click targets, day-key sequences, and month/week header labels are now computed in the plugin's business timezone (`timezone`, or the selected tenant's zone under `multiTenant`) rather than the browser's local timezone. Previously, viewing the calendar from a timezone different than the business's could make clicking a displayed time slot book a different wall-clock hour than the one shown.

### Plugin order matters under `multiTenant`

`payloadReserve()` must be listed **before** `multiTenantPlugin()` in the `plugins` array, and this plugin's collection slugs must appear in the multi-tenant plugin's own `collections` option:

```typescript
plugins: [
  payloadReserve({ /* ... */ }),
  multiTenantPlugin({
    collections: {
      // `customers` only exists in standalone mode (no `userCollection`).
      // Leaving it out means /api/reservation-customer-search keeps
      // returning every tenant's customers — there is no tenant field for
      // it to filter on.
      customers: {},
      reservations: {},
      resources: {},
      schedules: {},
      services: {},
    },
    // ...
  }),
]
```

At `payloadReserve`'s own plugin-time no tenant field exists on any collection yet (multi-tenant hasn't run), and multi-tenant only ever scopes the collections named in its own `collections` option — it never discovers them. So if you enable multi-tenant elsewhere in your config but forget to list payload-reserve's collections there, those documents silently stay readable across every tenant. The plugin now detects this at boot and logs a warning naming the unscoped slugs:

```
payload-reserve: these collections are NOT tenant-scoped: reservations, resources, schedules, services, customers. This config looks like it enables multi-tenancy (another collection carries a "tenant" field, or an auth collection carries a "tenants" membership array) — detection is a heuristic, so disregard this if you are not using multi-tenancy. Otherwise add these slugs to the multi-tenant plugin's "collections" option, or their documents stay readable across tenants.
```

Detection is a **heuristic** — the multi-tenant plugin exposes nothing at init to check directly — so the warning arms on either of two independent signals: some collection in your config carries a top-level tenant field, or an auth collection carries multi-tenant's `tenants` membership array. Each covers the other's blind spot (scoping *only* these collections and forgetting them all leaves nothing else carrying the field; `tenantsArrayField.includeDefaultField: false` removes the array). Neither is exact, so the warning can fire on a config that merely looks tenant-shaped — it is only ever a warning and never blocks boot.

Two more diagnostics fire under the same "multi-tenant detected" condition. In **standalone mode**, `/api/reserve/book`'s tenant-membership probe (above) is a real membership check only when the caller authenticates against the same collection multi-tenant wraps — standalone customers never do, so the plugin warns that the probe cannot actually verify a logged-in customer's membership there; point `userCollection` at multi-tenant's own admin auth collection to close it. In **`userCollection` mode**, if your auth collection carries *neither* a flat tenant field *nor* multi-tenant's `tenants` membership array, it is genuinely unscoped and the plugin warns naming it — the remedy depends on which collection multi-tenant treats as its own admin/tenant-owning collection: if it's this one, it needs the `tenants` array (which multi-tenant adds automatically unless disabled), not a listing in `collections`, which multi-tenant itself rejects for that collection; only a genuinely separate auth collection belongs in `collections`.

### Hook timing: every plugin hook fires before commit, never after

`afterBookingCreate`, `afterBookingConfirm`, `afterBookingCancel`, and `afterStatusChange` all fire **inside** the write's database transaction, not after it commits. Payload runs collection `afterChange` hooks and then commits in the same operation: verified directly against the installed package, `node_modules/payload/dist/collections/operations/create.js` invokes the collection's `afterChange` hooks at line 291 and calls `commitTransaction(req)` at line 324 — the only things that run in between are Payload's own `afterOperation` hook (which this plugin does not use) and `unlinkTempFiles`. The update path (where a status-change hook typically fires) is structurally identical.

Payload exposes **no** post-commit hook point — `afterOperation` is pre-commit too — so this is a documented constraint, not something a future version can quietly fix. In practice the failure window is narrow: the only way a plugin hook fires for a write that never actually lands is the commit itself failing *after* every hook already ran successfully — a database partition, not a routine validation failure (those throw earlier, from a `beforeChange` hook, before any `afterChange` hook or the commit is ever reached). **If your integration must not act on an uncommitted booking** (e.g. charging a card from `afterBookingConfirm`), make the side effect idempotent and reconcile afterward — upsert by reservation id, or verify the booking still exists before treating a webhook as authoritative — rather than relying on hook-vs-commit ordering to protect you.

### Concurrent booking: database adapter support

Two simultaneous bookers for the same slot are only kept from double-booking each other because a `beforeChange` hook (`acquireBookingLock`) writes each claimed resource's hidden `bookingLock` field inside the booking's own transaction — the database, not the plugin, is what forces the losers to wait or abort. **Before this existed, nothing prevented a double-booking at all:** measured on MongoDB, 10 simultaneous creates for one `quantity: 1` slot produced 10 confirmed reservations, and 8 simultaneous creates against a `quantity: 3` resource produced 8.

Because the lock only works *inside* a transaction, **a database that gives Payload no transaction gives no protection, silently.** A standalone (non-replica-set) MongoDB skips transactions entirely; SQLite needs `transactionOptions` set on the adapter (see below) or it never gets one either. The plugin's boot diagnostic (`supportsTransactions`) probes this at startup and warns if it fails:

```
payload-reserve: this database does not support transactions, so concurrent bookings for the same slot can double-book. MongoDB needs a replica set (even single-node) for transaction support. Postgres supports transactions by default. SQLite requires transactionOptions to be set on the adapter, or it silently runs without them.
```

**Retry is required on MongoDB and does nothing on Postgres.** `retryOnWriteConflict` re-runs the whole write on a fresh transaction when the failure is a recognized transient conflict (structured signals only — MongoDB's `errorLabels`/code, Postgres's SQLSTATE, SQLite's `code` prefix — never message text). MongoDB's loser aborts immediately rather than waiting, so without retry a `quantity: 3` resource recovers only 1 of 3 under a burst. Postgres's loser *blocks* until the winner commits and then proceeds through the normal conflict check on the merits, so retry never fires there at all — measured 3 of 3 recovered with no retry needed. `/api/reserve/book`, `/api/reserve/cancel`, and `/api/reserve/hold` all wrap their write in `retryOnWriteConflict`; a conflict that survives every attempt maps to a clean HTTP **409**, not a raw 500. Measured directly (burst of 8 concurrent creates against a `quantity: 3` resource; `dev/concurrency.int.spec.ts`, `dev/holds.int.spec.ts`):

| Adapter | Serializes? | Loser behavior | Capacity with no retry (of 3) | Retry recovers full capacity? |
|---|---|---|---|---|
| MongoDB (replica set) | Yes | Aborts (`WriteConflict`, code 112, `errorLabels: ['TransientTransactionError']`) | 1 of 3 | Yes at moderate contention — recovers the other 2 (3 of 3 for a burst of 8). **Not a guarantee under extreme contention:** the retry budget is finite (5 attempts), and a measured 40-way burst against a `quantity: 5` resource granted only 3, with the other 37 receiving clean `409`s. Capacity is never *exceeded*; it can still be *under-filled* when the burst is large relative to the budget. |
| Postgres 18.4 | Yes | Blocks, then proceeds; rejected bookings surface as a clean `ValidationError` (400) | 3 of 3 | Not needed — retry never fires |
| SQLite (`@payloadcms/db-sqlite`, `transactionOptions` set — **required**) | Yes, single-winner correctness | Aborts immediately at `beginTransaction`, before the transaction body ever runs (`LibsqlError`, `code: 'SQLITE_LOCKED_SHAREDCACHE'`, `rawCode: 262`) | 1 of 3 | **No** — capped at 1 of 3, even with retry attempted and a large retry budget |

**`transactionOptions` must be set on `sqliteAdapter(...)`, or SQLite silently double-books.** `@payloadcms/db-sqlite` wires up a real `beginTransaction` only when the adapter is given a truthy `transactionOptions`; without it, `beginTransaction` is a hard-coded no-op that always resolves `null`, so the plugin's booking lock never runs inside a transaction and serializes nothing. Measured with the adapter's bare default config (`sqliteAdapter({ client, push: true })`, no `transactionOptions`): every concurrency-sensitive assertion failed with complete, silent over-booking — 10 of 10 concurrent bookings for one slot persisted (expected 1), a `quantity: 3` resource accepted all 8 of a burst of 8, and 8 of 8 concurrent slot-hold attempts were all granted the same slot (expected 1) — no error, no rejected request, just extra rows. Postgres enables transactions by default and only needs `transactionOptions: false` to turn them *off*; SQLite has the inverse default. The plugin's boot diagnostic (`supportsTransactions`) detects a misconfigured adapter either way and warns at startup.

**With `transactionOptions` set** (the dev harness now ships `transactionOptions: {}` in its `SQLITE=1` branch, and this is required for production use too), SQLite correctly serializes for **single-winner** scenarios: exactly one of 10 concurrent bookings for one slot survives, a `quantity: 3` resource never exceeds capacity under a burst, overlapping-time bursts still yield exactly one booking, and — critically for holds — exactly one of 8 concurrent slot-hold attempts is granted. Every single-winner assertion in `dev/holds.int.spec.ts` passes under this configuration; only its `quantity: 3` capacity-recovery case does not, for the reason immediately below, which is the same reason the booking equivalent does not.

**Retry-based capacity recovery does not work for SQLite, and this is a limitation the plugin cannot fix.** `src/utilities/retryOnWriteConflict.ts` now recognizes the `SQLITE_BUSY`/`SQLITE_LOCKED*` code family (structured `code`-prefix match, same as the brief's constraint requires) — but in practice this detection never fires for SQLite's actual failure shape. Confirmed by direct inspection: the original `LibsqlError` (with `code: 'SQLITE_LOCKED_SHAREDCACHE'`) is caught **inside** `@payloadcms/drizzle`'s own `beginTransaction.js` (a Payload-core dependency, not this plugin) and re-thrown as a bare `new Error('Error: cannot begin transaction: ...')` — a plain object with a message string and nothing else (`Object.keys(error)` is empty; no `code`, no `cause`, `name` is the generic `'Error'`). By the time the error reaches this plugin's retry logic, the structured signal is already gone. Raising the retry budget from the default (5 attempts) to 30 makes no difference — confirmed each of the losing attempts fails exactly once, meaning retry is never even entered, since `isTransientWriteConflict` correctly returns `false` for an error with no matchable field. The only way to detect this failure would be matching on the error's message text, which this project's structured-signal-only constraint explicitly forbids. **Net effect: on SQLite, a `quantity: 1` resource is fully safe under concurrency (no double-booking, ever); a `quantity: N > 1` resource under a simultaneous burst will safely reject the excess rather than over-book, but will not recover to its full legitimate capacity the way Mongo and Postgres do** — some legitimately bookable slots may be lost under contention. This is a `@payloadcms/db-sqlite`/`@payloadcms/drizzle` limitation external to this plugin, not something addressed here.

**The same gap means `POST /api/reserve/book` returns a raw HTTP 500 under SQLite contention, not the clean `409` this plugin's retry/409 mapping (above) gives Mongo and Postgres.** `createBooking.ts` maps a surviving conflict to `409 { retryable: true }` by checking `isTransientWriteConflict` on whatever `retryOnWriteConflict` ultimately throws — the same check that cannot recognize SQLite's stripped `beginTransaction` error above. Measured directly: 6 simultaneous `POST /api/reserve/book` calls for the same slot correctly booked exactly one (no over-booking), but 5 of the 6 losers came back as `500`, not `409`. **Practically, this means a public booking widget backed by SQLite will show its generic error-handling UI, not a "someone just booked this, try again" message, whenever two customers click "Book" for the same slot at close to the same time** — the request still fails safely (nothing is double-booked), but the caller gets an opaque server error instead of an actionable one. This is the same external, unfixable-without-message-matching limitation described above, reaching a second call site.

#### Running the test suite against every adapter

The integration suite defaults to an in-memory MongoDB replica set. Run it against Postgres or SQLite with an env var — no code changes needed:

```bash
# Postgres — point PG_URL at a real, empty database
PG_URL="postgres://user:password@localhost:5432/reserve_test" CI=true pnpm test:int

# SQLite — in-memory by default
SQLITE=1 CI=true pnpm test:int
```

Both are opt-in dev/CI conveniences, not something a consumer's app needs to configure — they exist so this plugin's own suite can be verified against every adapter it claims to support. **Neither run is expected to be fully green by construction, and this is known, not a regression to chase.** Last measured (38 files, 539 tests):

| Run | Result | The gaps |
|---|---|---|
| MongoDB (default) | 38 files, 539 passed, 0 skipped | none |
| `PG_URL=…` | 38 files, 538 passed, 1 skipped | the `bufferFor error trace` skip below |
| `SQLITE=1` | 35 of 38 files, 535 passed, 3 failed, 1 skipped | the same `bufferFor` skip, plus **3 failures that are all one accepted upstream limitation**: `dev/concurrency.int.spec.ts`'s `quantity: 3` capacity recovery, `dev/holds.int.spec.ts`'s `quantity: 3` capacity recovery, and `dev/bookingRetry.int.spec.ts`'s no-500 assertion. All three trace to `@payloadcms/drizzle` discarding the driver's structured error code at `beginTransaction` (see the section above) — never "fix" any of them by matching on message text. |

The `bufferFor error trace` skip manufactures a dangling reference via `context.skipReservationHooks` to exercise a code path that the delete guard below makes structurally unreachable on a schema-enforced SQL database, so the scenario is MongoDB-only by construction.

### Slot holds (opt-in)

Short-lived claims on a slot, taken while a customer completes an external step (typically payment) before the booking itself exists. Enable with the `slotHolds` plugin option:

```typescript
payloadReserve({
  slotHolds: {
    enabled: true,
    ttlMinutes: 10, // default; how long an unconverted hold blocks its slot
  },
})
```

Disabled by default — when absent, no `reservation-holds` collection is created, neither endpoint below is registered, and availability behaviour is byte-identical to a plugin build without this feature at all. A hold occupies its resource exactly like a blocking reservation (folded into the same availability/conflict calculations); it carries no status, buffer, or `items[]` — one resource, one window, one clock. Expired holds are never trusted and are swept opportunistically, so no background job is required.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/reserve/hold` | `{ resource, service, startTime, endTime?, guestCount? }` | `201 { token, expiresAt }`; `409 { error: 'slot_taken' \| 'service_inactive' }` when the slot genuinely isn't available; `409 { error, retryable: true }` when lock contention outlived the retry budget; `404 { error: 'service_not_found' \| 'resource_not_found' }`; `400` for a missing or unparseable field |
| POST | `/api/reserve/hold/release` | `{ token }` | `200 { released: 0 \| 1 }` — always `200`, even for an already-released or expired token (idempotent) |

Pass the token straight through to `POST /api/reserve/book` as `holdToken` to convert a hold into a real booking — the hold is excluded from that request's own conflict check (so it doesn't block the very booking it was protecting) and the hold row is deleted on success, best-effort, so a delete failure never fails the booking itself.

**The hold token is a bearer secret, and the collection is closed to the REST API entirely** — `create`, `read`, `update` and `delete` all return `false`, so `GET /api/reservation-holds` is denied for every caller including admins. Anyone who can read a live token can release someone else's hold or book their slot with it, and `admin: { hidden: true }` hides only the nav link, not the route. The plugin's own reads and writes reach the collection through the Local API privileged, so nothing internal depends on those rules. **Under `multiTenant`, list the holds slug in the multi-tenant plugin's own `collections` option** alongside the scheduling collections — the boot diagnostic warns if you don't.

**Held slots are excluded from availability, not just from bookings.** `/api/reserve/availability`, `/api/reserve/slots` and `/api/reserve/resource-availability` all treat an unexpired hold as busy, so every customer-facing path agrees with the write path — a customer is never shown a slot the booking endpoint will then refuse with a `409`. That covers the reservation form's slot picker (`AvailabilityTimeField`, which fetches `/reserve/slots`) and the admin **Calendar** view (which fetches `/reserve/resource-availability`). Nothing in that path changes when `slotHolds` is off.

**Known limitation — the admin Availability grid does not show holds.** `AvailabilityOverview` (the weekly grid at `/reservation-availability`) does not use `/reserve/resource-availability`; it queries the `resources`, `schedules` and `reservations` REST endpoints directly and computes the grid in the browser, so an unexpired hold is invisible there and its slot reads as free. This is **display-only and admin-only**: it cannot cause a wrong write, because every write still goes through `checkAvailability`, which does count holds — an admin who books over a held slot from that grid is refused exactly as any other caller would be. Cross-check the Calendar view, or `/reserve/availability`, when holds matter.

### Deleting a referenced Service or Resource is blocked

Deleting a Service or Resource that a reservation still references (or, for a Resource, that a Schedule still references) now fails with an actionable `400`:

```
Cannot delete this resource: 2 reservations and 1 schedule still reference it. Uncheck "active" to retire it instead — that stops new bookings while keeping existing ones intact.
```

**This is a real behavioural change on MongoDB**, where the same delete previously succeeded silently, leaving the referencing reservation or schedule pointing at a document that no longer exists. On Postgres/SQLite the delete was never silent — it always failed — but with a raw, un-actionable database error (`23502`/`SQLITE_CONSTRAINT_NOTNULL`) rather than this message, because `service`/`resource` are required fields (`NOT NULL` in SQL) while the underlying adapter emits `ON DELETE SET NULL` for the same relationship, a self-contradictory schema only application code can resolve cleanly. The guard checks `items[]` references too, not just the top-level `service`/`resource` field, and covers multi-resource bookings the same way. Set `active: false` instead of deleting to retire a Service or Resource while keeping its booking (or schedule) history intact — this is what the error message points you at.

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

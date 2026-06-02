---
name: payload-reserve
description: >
  Expert guide for the payload-reserve plugin — a reservation and booking system for Payload CMS 3.x.
  Use when working with: reservation systems, booking systems, appointment scheduling, calendar views,
  availability checks, conflict detection, double-booking prevention, status workflows
  (pending/confirmed/completed/cancelled/no-show), buffer times, cancellation policies, schedule management,
  service/resource configuration, customer management, walk-in bookings, resource owner multi-tenancy,
  staff scheduling and auto-provisioning, guest (account-less) bookings, multi-resource bookings,
  required resource pools, time-off / leave management, capacity and inventory, extra reservation fields,
  admin UI components (calendar, lanes timeline, dashboard widget, availability grid, availability-aware
  time picker), CalendarView resource filter, internationalization / translations, or integrating
  payments (Stripe) and notifications with a Payload CMS reservation plugin. Triggers on: "payload-reserve",
  "payloadReserve", "reservation plugin", "booking plugin", "appointment plugin", "schedule plugin",
  "availability overview", "calendar view", "reservation conflict", "double booking", "booking status",
  "cancellation policy", "resource owner", "resourceOwnerMode", "multi-tenant reservations",
  "extra reservation fields", "staff provisioning", "staffProvisioning", "guest booking",
  "allowGuestBooking", "requiredResources", "multi-resource booking", "time off", "leaveTypes",
  "resourceTypes", "reservation translations", "reservation i18n".
---

# payload-reserve

A full-featured reservation/booking plugin for Payload CMS 3.x. Adds scheduling with conflict
detection, a configurable status machine, multi-resource bookings (with auto-expanded required
resource pools), capacity tracking, resource owner multi-tenancy, staff scheduling & auto-provisioning,
guest (account-less) bookings, extra reservation fields, 6 public REST endpoints, and admin UI
components (calendar view with month/week/day/lanes/pending modes + availability shading and
click-to-book, an availability-aware time picker, dashboard widget, availability grid). Fully
internationalized — ships 12 admin-UI locales.

## Install

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

Peer dependencies: `payload ^3.79.0`, `@payloadcms/ui ^3.79.0`, `@payloadcms/translations ^3.79.0`

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [/* your collections */],
  plugins: [
    payloadReserve(), // zero-config — all defaults apply
  ],
})
```

## What Gets Created (defaults)

**5 collections:** `services`, `resources`, `schedules`, `customers` (auth), `reservations`

**Admin components:** Calendar view (replaces reservations list — month/week/day/lanes/pending, with availability shading + click-to-book), availability-aware `startTime` slot picker on the reservation form, Dashboard widget (today's stats), Availability overview at `/admin/reservation-availability`

**6 REST endpoints:** `GET /api/reserve/availability`, `GET /api/reserve/slots`, `GET /api/reserve/resource-availability`, `POST /api/reserve/book` (supports `guest` + `items`), `POST /api/reserve/cancel` (owner/admin or guest via `token`), `GET /api/reservation-customer-search`

**Default status flow:** `pending` -> `confirmed` -> `completed | cancelled | no-show`

## Extend Your Own Users Collection

```typescript
payloadReserve({
  userCollection: 'users', // injects name, phone, notes, bookings join into your existing collection
})
```

## Resource Owner Multi-Tenancy

Opt-in mode for Airbnb-style platforms where each user manages their own resources.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'],
    ownerField: 'owner',
    ownedServices: false,
  },
})
```

Auto-wires ownership access control on Resources, Schedules, and Reservations. Set `ownedServices: true` to also scope Services. The `access` override in plugin config always takes precedence. Set `ownerCollection` when owners live in a different collection than your customers (e.g. staff in `users`); it defaults to `staffProvisioning.userCollection ?? slugs.customers`.

## Staff Scheduling & Auto-Provisioning

Opt-in `staffProvisioning` (requires `resourceOwnerMode`) auto-creates an owner-scoped Resource whenever a user gains a staff role. The Resource is created by impersonating the staff user, so `owner` is always that user. Idempotent, non-blocking, never auto-deleted on demotion.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: { adminRoles: ['admin'] },
  staffProvisioning: {
    staffRoles: ['stylist', 'therapist'], // required, non-empty
    roleField: 'role',     // default 'role'
    resourceType: 'staff', // must be a valid resourceType
    nameFrom: 'name',      // default 'name', falls back to email
    beforeCreate: ({ data, user }) => ({ ...data, tenant: user.tenant }), // optional tenant stamp
  },
})
```

Staff manage their own time off via `Schedule.exceptions` (`date`, optional `endDate` inclusive range, `type` from `leaveTypes`). Customize the `resourceTypes` (default `['staff','equipment','room']`) and `leaveTypes` (default `['vacation','sick','personal','closure','other']`) vocabularies.

## Guest (Account-less) Bookings

```typescript
payloadReserve({ allowGuestBooking: true }) // per-service override: 'inherit' | 'enabled' | 'disabled'
```

A guest booking carries inline `guest` (name + email/phone) instead of a `customer` (now optional). The plugin generates a `cancellationToken` exposed via `afterBookingCreate` (never returned over the API); guests cancel via `POST /api/reserve/cancel { reservationId, token }`. The plugin sends no email/SMS itself.

## Multi-Resource Bookings

A service can declare `requiredResources` (hasMany) — extra pools every booking occupies (e.g. a shared chair). On create, `expandRequiredResources` appends them to `items[]` and conflict detection blocks the booking if any pool is full. Slot discovery intersects the schedules/capacity of all required resources.

## Internationalization

All admin strings are translatable; 12 locales bundled (`en`, `fr`, `de`, `es`, `ru`, `pl`, `tr`, `ar`, `zh`, `id`, `fa`, `hi`). Translations merge into Payload's `i18n` config and host-provided translations take precedence. All but Hindi ship in Payload core and appear in the language switcher automatically; `hi` must be registered as a custom language by the host. See `references/i18n.md`.

## Common Config Options

```typescript
payloadReserve({
  adminGroup: 'Reservations',       // admin panel group label
  defaultBufferTime: 0,             // buffer minutes between bookings
  cancellationNoticePeriod: 24,     // minimum hours notice to cancel
  userCollection: 'users',          // extend existing auth collection
  disabled: false,                  // set true to disable plugin
  extraReservationFields: [],       // extra Payload fields appended to Reservations
  allowGuestBooking: false,         // account-less bookings (per-service override available)
  resourceTypes: ['staff', 'equipment', 'room'],          // Resource.resourceType options (1st is default)
  leaveTypes: ['vacation', 'sick', 'personal', 'closure', 'other'], // Schedule.exceptions[].type options
  resourceOwnerMode: {              // opt-in multi-tenant owner mode
    adminRoles: ['admin'],
    ownerField: 'owner',
    ownedServices: false,
    ownerCollection: 'users',       // collection the owner field relates to
  },
  staffProvisioning: {              // opt-in; REQUIRES resourceOwnerMode
    staffRoles: ['stylist'],
  },
})
```

## Key Patterns

- **Escape hatch** — bypass all validation hooks: `context: { skipReservationHooks: true }` on any `payload.create/update` call
- **Status machine** — fully configurable; `blockingStatuses` control conflict detection, `terminalStatuses` lock records
- **Idempotency** — pass `idempotencyKey` on POST /api/reserve/book to prevent duplicate submissions
- **endTime** — always auto-calculated from `startTime + service.duration`; do not set manually for `fixed` services
- **Guest vs customer** — a reservation needs **either** a `customer` **or** a `guest` (not both); guest cancellation uses the `cancellationToken` delivered via `afterBookingCreate`
- **Role-aware staff/admin detection** — in single-collection (`userCollection`) setups, staff are detected by role (`adminRoles ∪ staffRoles`), not just collection; required for staff to create non-default-status bookings, cancel others' bookings, and use customer search
- **Multi-resource conflicts** — conflict detection counts a resource held at top-level `resource` **or** inside any booking's `items[]`; a service's `requiredResources` are auto-expanded into `items[]`

## Reference Files

Load the relevant file when the user's question is about that topic:

| Topic | File |
|-------|------|
| All plugin options, slugs, access, resourceOwnerMode, staffProvisioning, resourceTypes/leaveTypes, full config example | `references/configuration.md` |
| Collection schemas (fields, types, examples — incl. guest, items, requiredResources, owner, exceptions) | `references/collections.md` |
| Status machine config, custom statuses, transitions, internal hook order | `references/status-machine.md` |
| Duration types, multi-resource bookings, required resources, capacity modes, guest bookings | `references/booking-features.md` |
| Plugin hook callbacks + the staff-provisioning user hook | `references/hooks-api.md` |
| REST API: all 6 endpoints (params, responses, fetch examples) | `references/rest-api.md` |
| Admin UI: CalendarView (lanes/pending + shading), availability time field, dashboard widget, availability overview | `references/admin-ui.md` |
| Real-world examples: salon, hotel, restaurant, staff scheduling, guest bookings, multi-resource, Stripe, email, multi-tenant | `references/examples.md` |
| Internationalization: bundled locales, overriding strings, adding a language, Hindi setup | `references/i18n.md` |
| DB indexes, reconciliation job, capacity/multi-resource race notes | `references/advanced.md` |

# Getting Started

Everything you need to install `payload-reserve` and have it running in your Payload CMS project.

## Installation

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependencies:** `payload ^3.79.0`, `@payloadcms/ui ^3.79.0`, `@payloadcms/translations ^3.79.0`

### ⚠️ Upgrading from an earlier version

**Run `payload generate:importmap`, then restart your app, after upgrading — even if you never touch the new `components` option.** The Reservations list view's default component changed from `payload-reserve/client#CalendarView` to `payload-reserve/rsc#CalendarViewServer`. Payload resolves admin component paths through an import map generated **into your own app**, not this package, so restarting on the new version without regenerating it leaves the old key in place and the new one missing — silently: a missing import-map key logs a `console.error` server-side, and the admin just shows a plain reservations table where the calendar used to be, with nothing explaining why. See the README's "⚠️ Upgrading from an earlier version" section and [Admin UI → Customising the admin components](./admin-ui.md#customising-the-admin-components) for the full detail, including the new reservation detail drawer this release adds.

## Quick Start

Add the plugin to your `payload.config.ts`:

```typescript
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [
    // Your existing collections including your users/auth collection
  ],
  plugins: [
    payloadReserve(),
  ],
})
```

That's it. The plugin registers the domain collections, adds a dashboard widget, replaces the reservations list view with a calendar, and mounts the public API endpoints. All plugin collections appear under the **"Reservations"** admin group by default.

## What Gets Created

By default, with no options set, the plugin creates:

**5 collections:**
- `services` — what can be booked (treatments, room types, service offerings)
- `resources` — who/what performs the service (staff, rooms, equipment)
- `schedules` — when resources are available (recurring weekly patterns + manual dates)
- `customers` — a standalone auth collection for customers to log in (a customer can read and update only their own document and their own reservations; staff see everything — see [Configuration → Access control for customers](./configuration.md#access-control-for-customers))
- `reservations` — the core booking records

**3 admin UI components:**
- Calendar view replacing the default reservations list (month/week/day/lanes/pending, with availability shading and click-to-book). Clicking a reservation opens a read-optimized detail drawer (status, key fields, and status actions) before the full edit form — see [Admin UI → Reservation Detail Drawer](./admin-ui.md#reservation-detail-drawer)
- Dashboard widget showing today's booking stats
- Availability overview at `/admin/reservation-availability`

All six of the admin components above (including the detail drawer) can be replaced with your own via the `components` plugin option — see [Admin UI → Customising the admin components](./admin-ui.md#customising-the-admin-components).

**6 public REST endpoints:**
- `GET /api/reserve/availability` — available slots for a date (guest-count and multi-resource aware)
- `GET /api/reserve/slots` — slots with richer metadata + guest count support
- `GET /api/reserve/resource-availability` — a resource's shift windows, time-off, and busy intervals over a date range (backs the calendar shading)
- `POST /api/reserve/book` — create a booking (supports account-less `guest` bookings and multi-resource `items`)
- `POST /api/reserve/cancel` — cancel a booking (authenticated owner/admin, or guest via cancellation token)
- `GET /api/reservation-customer-search` — customer search (privileged staff/admin only)

> For multi-tenant setups where staff own their own resources, see [`resourceOwnerMode` and `staffProvisioning`](./configuration.md). The admin UI is fully translatable — see [Internationalization](./i18n.md).

## Using Your Existing Users Collection

By default the plugin creates a standalone `customers` auth collection. To extend your own users collection instead, set the `userCollection` option:

```typescript
payloadReserve({
  userCollection: 'users', // your existing auth collection slug
})
```

When `userCollection` is set, the plugin injects `name`, `phone`, `notes`, and a `bookings` join field into your existing collection rather than creating a separate Customers collection. Existing fields with the same name are preserved (the plugin only injects what's missing). See [Collections → Customers](./collections.md#customers) for details.

---

← [Back to README](../README.md) | → [Configuration](./configuration.md)

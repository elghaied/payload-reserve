# Getting Started

Everything you need to install `payload-reserve` and have it running in your Payload CMS project.

## Installation

```bash
# Payload 4
pnpm add payload-reserve@next
# Payload 3
pnpm add payload-reserve@4
```

**Peer dependencies:** `payload`, `@payloadcms/ui`, `@payloadcms/translations` — `^4.0.0-beta.9` for 5.x (`next`), `^3.86.0` for 4.x

### ⚠️ Upgrading from an earlier version

**Run `payload generate:importmap`, then restart your app, after upgrading — even if you never touch the new `components` option.** The Reservations list view's default component changed from `payload-reserve/client#CalendarView` to `payload-reserve/rsc#CalendarViewServer`. Payload resolves admin component paths through an import map generated **into your own app**, not this package, so restarting on the new version without regenerating it leaves the old key in place and the new one missing — silently: a missing import-map key logs a `console.error` server-side, and the admin just shows a plain reservations table where the calendar used to be, with nothing explaining why. See the [Admin UI → Customising the admin components](./admin-ui.md#customising-the-admin-components) for the full detail, including the new reservation detail drawer this release adds.

### Upgrading to 5.x (Payload 4)

5.x requires Payload 4. Upgrade Payload first (its codemod, `npx @payloadcms/codemod`, handles most of it), then:

- **Local API calls on the plugin's collections from your own code** need `overrideAccess: true` wherever you relied on the old default. Payload 4 access-checks the Local API unless told otherwise.
- **`userCollection` pointing at a collection that is not your admin collection:** Payload 4's default access only admits users of the admin collection, so those users can no longer read reservations, services, resources or schedules through the collection REST API until you supply `access` rules. The `/api/reserve/*` endpoints are unaffected. The plugin warns about this at boot.
- **Custom CSS aimed at the plugin's admin components:** class names are now fixed and readable (`reserve-calendar__toolbar`, `reserve-detail__…`) instead of hashed, and colours use Payload 4's `--color-*` variables.
- **No new tables:** the plugin's collections opt out of Payload 4's default versions and `createdBy`/`updatedBy` columns. Turn them back on per collection with `collectionOverrides` if you want them.
- Run `payload generate:importmap` and restart.

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

## TanStack Start

Payload 4 also runs on TanStack Start. The admin components work there, with one line of host config: Payload's adapter bundles `@payloadcms/plugin-*` packages for the server automatically, but not third-party plugins, so add the plugin to `noExternal` in `vite.config.ts`:

```ts
export default defineConfig(
  withPayload(
    ({ pluginOptions }) => ({
      plugins: [/* rsc, tanstackStart, viteReact — as in the template */],
      environments: {
        rsc: { resolve: { noExternal: ['payload-reserve'] } },
        ssr: { resolve: { noExternal: ['payload-reserve'] } },
      },
    }),
    { payloadConfigPath: './src/payload.config.ts' },
  ),
)
```

Without it the admin fails with `Unknown file extension ".css"`. Next.js needs no extra config.

> **Using SQLite?** Set `transactionOptions` on the adapter, or concurrent bookings can double-book — see [Concurrent Bookings](./concurrency.md).

## What Gets Created

By default, with no options set, the plugin creates:

**5 collections:**
- `services` — what can be booked (treatments, room types, service offerings)
- `resources` — who/what performs the service (staff, rooms, equipment)
- `schedules` — when resources are available (recurring weekly patterns + manual dates)
- `customers` — a standalone auth collection for customers to log in (a customer can read and update only their own document and their own reservations; staff see everything — see [Configuration → Access control for customers](./configuration.md#access-control-for-customers))
- `reservations` — the core booking records

**Admin UI:**
- Calendar view replacing the default reservations list (month/week/day/lanes/pending, with availability shading and click-to-book). Clicking a reservation opens a read-optimized detail drawer (status, key fields, and status actions) before the full edit form — see [Admin UI → Reservation Detail Drawer](./admin-ui.md#reservation-detail-drawer)
- Dashboard widget showing today's booking stats
- Availability overview at `/admin/reservation-availability`

All six admin components (these, plus the detail drawer and the two reservation-form fields) can be replaced with your own via the `components` plugin option — see [Admin UI → Customising the admin components](./admin-ui.md#customising-the-admin-components).

**REST endpoints:**
- `GET /api/reserve/availability` — available slots for a date (guest-count and multi-resource aware)
- `GET /api/reserve/slots` — slots with richer metadata + guest count support
- `GET /api/reserve/resource-availability` — a resource's shift windows, time-off, and busy intervals over a date range (backs the calendar shading)
- `POST /api/reserve/book` — create a booking (supports account-less `guest` bookings and multi-resource `items`)
- `POST /api/reserve/cancel` — cancel a booking (authenticated owner/admin, or guest via cancellation token)
- `GET /api/reservation-customer-search` — customer search (privileged staff/admin only)
- `GET /api/reserve/effective-timezone` — the business timezone for the signed-in user's selected tenant
- `POST /api/reserve/hold` and `/api/reserve/hold/release` — only when [`slotHolds`](./slot-holds.md) is enabled

For your booking frontend, [`payload-reserve/sdk`](./sdk.md) wraps these in a typed client.

> For multi-tenant setups where staff own their own resources, see [`resourceOwnerMode` and `staffProvisioning`](./configuration.md). The admin UI is fully translatable — see [Internationalization](./i18n.md).

## The boot setup check

At startup the plugin checks your config for the problems it can detect — a database without transactions, access rules that leave customers too open or locked out, collections the multi-tenant plugin is not scoping, admin component options that cancel each other out. Everything it finds is printed as **one** warning:

```
payload-reserve setup check: 2 things need attention.

1. this database does not support transactions, so concurrent bookings for the same slot can double-book. ...

2. "userCollection" is set but no "access.reservations" rule narrows reads, ...

Checked and fine: services–resources join, admin components.
```

Nothing is printed when there is nothing to fix. The checks are warnings only and never stop the app from booting. Some are heuristics (multi-tenancy cannot be detected exactly), and the message says so when that applies.

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

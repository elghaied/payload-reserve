# payload-reserve

[![npm version](https://img.shields.io/npm/v/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![npm downloads](https://img.shields.io/npm/dm/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![license](https://img.shields.io/npm/l/payload-reserve.svg)](./LICENSE)
[![Payload Directory](https://payloaddirectory.dev/badge/1157211530-root.svg)](https://payloaddirectory.dev/plugins/1157211530-root)

A full-featured reservation and booking plugin for Payload CMS (this branch targets Payload 4; see Compatibility). Adds a scheduling system with conflict detection, a configurable status machine, multi-resource bookings, capacity and inventory tracking, a public REST API, and admin UI components.

Designed for salons, clinics, hotels, restaurants, event venues, and any business that needs appointment scheduling managed through Payload's admin panel.

📦 **npm:** https://www.npmjs.com/package/payload-reserve

**[Website](https://payloadreserve.com)** · **[Documentation](https://docs.payloadreserve.com)** · **[Live demos](#live-demos)** · **[Demo source code](https://github.com/elghaied/payloadreserve-demos)**

---

## Compatibility

| payload-reserve | Payload | Install |
|---|---|---|
| 5.x (prerelease) | 4.x (`^4.0.0-beta.9`) — Next.js or TanStack Start | `pnpm add payload-reserve@next` |
| 4.x | 3.x (`^3.86.0`) — security fixes continue | `pnpm add payload-reserve@4` |

Payload 4 needs Node `^24.22.3 || >=26.13.1`.

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [/* your collections */],
  plugins: [payloadReserve()],
})
```

Then run `payload generate:importmap` and restart. You get Services, Resources, Schedules, Reservations and Customers collections, a calendar in place of the reservations list, a dashboard widget, and the public booking API under `/api/reserve/*`.

Three things to know before going live:

- **Database:** MongoDB needs a replica set and SQLite needs `transactionOptions` on the adapter, or simultaneous bookings can double-book. Postgres works as is. See [Concurrent Bookings](./docs/concurrency.md).
- **TanStack Start:** add `payload-reserve` to `noExternal` in `vite.config.ts`. See [Getting Started](./docs/getting-started.md#tanstack-start).
- **Your own users collection:** set `userCollection` and supply an access rule for customers. See [Access control for customers](./docs/configuration.md#access-control-for-customers).

## Features

- **Bookings that cannot collide** — conflict detection with per-service buffers, capacity (`quantity`, per-guest or per-reservation), and a database lock for simultaneous bookers
- **Three duration types** — fixed, flexible (customer picks the end) and full-day
- **Multi-resource bookings** — one reservation across several resources, including pools a service always requires
- **Schedules** — weekly or one-off hours, exceptions and multi-day time off, in your business timezone
- **Configurable status machine** — your own statuses and transitions, with a cancellation notice period
- **Guest bookings** — no account needed; cancel by token
- **Slot holds** — reserve a slot for a few minutes while the customer pays
- **Lifecycle hooks** — seven hooks for email, payments and webhooks
- **Admin UI** — month/week/day/lanes calendar, pending list, reservation detail drawer, availability grid, dashboard widget; every piece replaceable
- **Public REST API** — availability, slots, book, cancel, holds
- **Multi-tenancy** — resource-owner mode, and support for `@payloadcms/plugin-multi-tenant` with per-tenant timezones
- **External calendars** — fold busy time from Google/Outlook sync or a legacy system into availability
- **12 languages**, fully typed, MongoDB / Postgres / SQLite

## Live Demos

Four standalone booking apps, each fully themed and running the **same plugin** with completely different business logic — the fastest way to see whether payload-reserve fits your use case before wiring anything up.

| Demo | What it books | Plugin features it exercises |
|------|---------------|------------------------------|
| **[Salon](https://salon.payloadreserve.com)** — Lumiere Salon | Appointments with a specific stylist | 1:1 resource booking, per-resource schedules, 5 min buffer, abandoned-payment jobs |
| **[Hotel](https://hotel.payloadreserve.com)** — Grand Hotel | Multi-night stays across 5 room types | Date-range booking, `flexible` duration, quantity pools (2–40 units), 4–6 h turnover buffer |
| **[Restaurant](https://restaurant.payloadreserve.com)** — Le Jardin Doré | Tables by party size across 5 dining spaces | Custom reservation fields (`partySize`), per-guest capacity, 15 min turnover, 4 h cancellation notice |
| **[Events](https://events.payloadreserve.com)** — Éclat Festival | Tickets for events across 5 venues (50–500 seats) | Ticket quantities, per-reservation capacity mode, resource–event restrictions |

All four ship Stripe payments and EN/FR internationalization.

**Source code:** [`elghaied/payloadreserve-demos`](https://github.com/elghaied/payloadreserve-demos) — a Turborepo containing all four apps plus shared seed, email-template, and types packages. This is the reference implementation for taking the plugin from Payload config to a shipped Next.js 15 / React 19 frontend.

**Want your own instance?** [payloadreserve.com/demo](https://payloadreserve.com/demo) provisions a private, fully seeded copy of any demo — its own database, storage, and admin credentials, emailed to you. It self-destructs after 24 hours, so you can change anything without consequence.

## Documentation

Also published at **[docs.payloadreserve.com](https://docs.payloadreserve.com)**.

| Start here | |
|---|---|
| [Getting Started](./docs/getting-started.md) | Install, quick start, what gets created, upgrading |
| [Configuration](./docs/configuration.md) | Every plugin option with its default |
| [Examples](./docs/examples.md) | Salon, hotel, restaurant, events, Stripe, email |

| Booking | |
|---|---|
| [Collections](./docs/collections.md) | Fields of each collection, the delete guard |
| [Booking Features](./docs/booking-features.md) | Duration types, multi-resource, capacity, guest bookings |
| [Status Machine](./docs/status-machine.md) | Statuses, transitions, the hook chain |
| [Slot Holds](./docs/slot-holds.md) | Holding a slot during checkout |
| [Staff Scheduling](./docs/staff-scheduling.md) | Auto-provisioned staff resources, time off |
| [Timezones](./docs/timezones.md) | Business and per-tenant timezones |

| Integrating | |
|---|---|
| [REST API](./docs/rest-api.md) | Endpoints, parameters, responses |
| [Hooks API](./docs/hooks-api.md) | The seven lifecycle hooks and when they fire |
| [Admin UI](./docs/admin-ui.md) | Calendar, detail drawer, replacing components, styling |
| [External Busy](./docs/external-busy.md) | Calendar sync and other busy-time sources |
| [Internationalization](./docs/i18n.md) | Bundled languages, overriding strings |

| Running it safely | |
|---|---|
| [Access Control](./docs/access-control.md) | Default access per user type, how endpoints authorize |
| [Multi-Tenancy](./docs/multi-tenancy.md) | Resource-owner mode and the multi-tenant plugin |
| [Concurrent Bookings](./docs/concurrency.md) | Database requirements and measured behaviour per adapter |
| [Advanced](./docs/advanced.md) | Indexes, collection overrides, reconciliation |

Changes per release are in the [CHANGELOG](./CHANGELOG.md). Contributing and release steps are in [Development](./docs/development.md).

## License

MIT

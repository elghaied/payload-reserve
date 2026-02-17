# payload-reserve

A full-featured reservation and booking plugin for Payload CMS 3.x. Adds a scheduling system with conflict detection, a configurable status machine, multi-resource bookings, capacity and inventory tracking, a public REST API, and admin UI components.

Designed for salons, clinics, hotels, restaurants, event venues, and any business that needs appointment scheduling managed through Payload's admin panel.

---

## Features

- **4 Domain Collections** — Services, Resources, Schedules, Reservations with full CRUD
- **User Collection Extension** — Extends your existing auth collection with booking fields instead of creating a separate Customers collection
- **Configurable Status Machine** — Define your own statuses, transitions, and terminal states
- **Double-Booking Prevention** — Server-side conflict detection with configurable buffer times
- **Auto End Time** — Calculates `endTime` from `startTime + service.duration` automatically
- **Three Duration Types** — Fixed, flexible (customer-specified end), and full-day bookings
- **Multi-Resource Bookings** — Single reservation that spans multiple resources simultaneously
- **Capacity and Inventory** — `quantity > 1` allows multiple concurrent bookings per resource; `capacityMode` switches between per-reservation and per-guest counting
- **Idempotency** — Optional `idempotencyKey` field prevents duplicate submissions
- **Cancellation Policy** — Configurable minimum notice period enforcement
- **Plugin Hooks API** — Fire callbacks on create, confirm, cancel, and status change
- **Public REST API** — Five pre-built endpoints for availability checking, slot listing, booking, and cancellation
- **Calendar View** — Month/week/day calendar replacing the default reservations list view
- **Dashboard Widget** — Server component showing today's booking stats
- **Availability Overview** — Weekly grid of resource availability vs. booked slots
- **Recurring and Manual Schedules** — Weekly patterns with exception dates, or specific one-off dates
- **Localization Support** — Collection fields can be localized when Payload localization is enabled
- **Type-Safe** — Full TypeScript support with exported types

---

## Install

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependency:** `payload ^3.37.0`

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

## Documentation

| File | Contents |
|------|----------|
| [Getting Started](./docs/getting-started.md) | Installation, quick start, what gets created |
| [Configuration](./docs/configuration.md) | All plugin options with types and defaults |
| [Collections](./docs/collections.md) | Services, Resources, Schedules, Customers, Reservations schemas |
| [Status Machine](./docs/status-machine.md) | Default flow, custom machines, business logic hooks, escape hatch |
| [Booking Features](./docs/booking-features.md) | Duration types, multi-resource bookings, capacity modes |
| [Hooks API](./docs/hooks-api.md) | All 7 plugin hook types with signatures and examples |
| [REST API](./docs/rest-api.md) | All 5 public endpoints with params, responses, and fetch examples |
| [Admin UI](./docs/admin-ui.md) | Calendar view, dashboard widget, availability overview |
| [Examples](./docs/examples.md) | Salon, hotel, restaurant, event venue, Stripe, email, multi-tenant |
| [Advanced](./docs/advanced.md) | DB indexes, reconciliation job for race condition detection |
| [Development](./docs/development.md) | Prerequisites, commands, project file tree |

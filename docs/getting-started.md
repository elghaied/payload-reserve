# Getting Started

Everything you need to install `payload-reserve` and have it running in your Payload CMS project.

## Installation

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependency:** `payload ^3.37.0`

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
- `customers` — a standalone auth collection for customers to log in
- `reservations` — the core booking records

**3 admin UI components:**
- Calendar view replacing the default reservations list (month/week/day)
- Dashboard widget showing today's booking stats
- Availability overview at `/admin/reservation-availability`

**5 public REST endpoints:**
- `GET /api/reserve/availability` — available slots for a date
- `GET /api/reserve/slots` — slots with richer metadata + guest count support
- `POST /api/reserve/book` — create a booking
- `POST /api/reserve/cancel` — cancel a booking
- `GET /api/reserve/customers` — customer search

## Using Your Existing Users Collection

By default the plugin creates a standalone `customers` auth collection. To extend your own users collection instead, set the `userCollection` option:

```typescript
payloadReserve({
  userCollection: 'users', // your existing auth collection slug
})
```

When `userCollection` is set, the plugin injects `phone`, `notes`, and a `bookings` join field into your existing collection rather than creating a separate Customers collection. See [Collections → Customers](./collections.md#customers) for details.

---

← [Back to README](../README.md) | → [Configuration](./configuration.md)

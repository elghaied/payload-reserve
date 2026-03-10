---
name: payload-reserve
description: >
  Expert guide for the payload-reserve plugin — a reservation and booking system for Payload CMS 3.x.
  Use when working with: reservation systems, booking systems, appointment scheduling, calendar views,
  availability checks, conflict detection, double-booking prevention, status workflows
  (pending/confirmed/completed/cancelled/no-show), buffer times, cancellation policies, schedule management,
  service/resource configuration, customer management, walk-in bookings, resource owner multi-tenancy,
  extra reservation fields, admin UI components (calendar, dashboard widget, availability grid),
  CalendarView resource filter, or integrating payments (Stripe) and notifications with a Payload CMS
  reservation plugin. Triggers on: "payload-reserve", "payloadReserve", "reservation plugin",
  "booking plugin", "appointment plugin", "schedule plugin", "availability overview", "calendar view",
  "reservation conflict", "double booking", "booking status", "cancellation policy",
  "resource owner", "resourceOwnerMode", "multi-tenant reservations", "extra reservation fields".
---

# payload-reserve

A full-featured reservation/booking plugin for Payload CMS 3.x. Adds scheduling with conflict
detection, a configurable status machine, multi-resource bookings, capacity tracking, resource
owner multi-tenancy, extra reservation fields, 5 public REST endpoints, and admin UI components
(calendar view with resource filter, dashboard widget, availability grid). Supports localization.

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

**3 admin components:** Calendar view (replaces reservations list), Dashboard widget (today's stats), Availability overview at `/admin/reservation-availability`

**5 REST endpoints:** `GET /api/reserve/availability`, `GET /api/reserve/slots`, `POST /api/reserve/book`, `POST /api/reserve/cancel`, `GET /api/reserve/customers`

**Default status flow:** `pending` -> `confirmed` -> `completed | cancelled | no-show`

## Extend Your Own Users Collection

```typescript
payloadReserve({
  userCollection: 'users', // injects phone, notes, bookings join into your existing collection
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

Auto-wires ownership access control on Resources, Schedules, and Reservations. Set `ownedServices: true` to also scope Services. The `access` override in plugin config always takes precedence.

## Common Config Options

```typescript
payloadReserve({
  adminGroup: 'Reservations',       // admin panel group label
  defaultBufferTime: 0,             // buffer minutes between bookings
  cancellationNoticePeriod: 24,     // minimum hours notice to cancel
  userCollection: 'users',          // extend existing auth collection
  disabled: false,                  // set true to disable plugin
  extraReservationFields: [],       // extra Payload fields appended to Reservations
  resourceOwnerMode: {              // opt-in multi-tenant owner mode
    adminRoles: ['admin'],
    ownerField: 'owner',
    ownedServices: false,
  },
})
```

## Key Patterns

- **Escape hatch** — bypass all validation hooks: `context: { skipReservationHooks: true }` on any `payload.create/update` call
- **Status machine** — fully configurable; `blockingStatuses` control conflict detection, `terminalStatuses` lock records
- **Idempotency** — pass `idempotencyKey` on POST /api/reserve/book to prevent duplicate submissions
- **endTime** — always auto-calculated from `startTime + service.duration`; do not set manually for `fixed` services

## Reference Files

Load the relevant file when the user's question is about that topic:

| Topic | File |
|-------|------|
| All plugin options, slugs, access, resourceOwnerMode, full config example | `references/configuration.md` |
| Collection schemas (fields, types, examples) | `references/collections.md` |
| Status machine config, custom statuses, transitions | `references/status-machine.md` |
| Duration types, multi-resource bookings, capacity modes | `references/booking-features.md` |
| Plugin hook callbacks (afterBookingCreate, afterStatusChange, etc.) | `references/hooks-api.md` |
| REST API endpoints (params, responses, fetch examples) | `references/rest-api.md` |
| Admin UI: CalendarView, dashboard widget, availability overview | `references/admin-ui.md` |
| Real-world examples: salon, hotel, restaurant, Stripe, email, resource owner multi-tenant | `references/examples.md` |
| DB indexes, reconciliation job, performance tuning | `references/advanced.md` |

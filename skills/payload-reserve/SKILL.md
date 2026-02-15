---
name: payload-reserve
description: >
  Expert guide for the payload-reserve plugin — a Payload CMS 3.x reservation/booking system.
  Use when working with: reservation systems, booking systems, appointment scheduling,
  calendar views, availability checks, conflict detection, double-booking prevention,
  status workflows (pending/confirmed/completed/cancelled/no-show), buffer times,
  cancellation policies, schedule management, service/resource configuration,
  customer management, walk-in bookings, or integrating payments (Stripe) and
  notifications with a Payload CMS reservation plugin.
  Triggers on: "payload-reserve", "payloadReserve", "reservation plugin", "booking plugin",
  "appointment plugin", "schedule plugin", "availability overview", "calendar view",
  "reservation conflict", "double booking", "booking status", "cancellation policy".
---

# payload-reserve Plugin Guide

## Overview

`payload-reserve` is a Payload CMS 3.x plugin that injects a complete reservation/booking system:

- **5 collections**: Services, Resources, Schedules, Reservations, Customers
- **Customers auth collection**: Dedicated auth collection (`auth: true`) with `access.admin: () => false` — customers get JWT auth endpoints but cannot access the admin panel
- **4 beforeChange hooks**: Auto endTime calculation, conflict detection, status state machine, cancellation policy
- **Admin components**: Dashboard widget (RSC), Calendar view (client), Customer picker (client), Availability grid (client)
- **Custom endpoint**: `/api/reservation-customer-search` for multi-field customer search

**Plugin pattern**: Higher-order function `(pluginOptions) => (config) => modifiedConfig`.

**Three export paths**:
- `payload-reserve` — server-side plugin function, types, and utility functions
- `payload-reserve/client` — CalendarView, AvailabilityOverview, CustomerField
- `payload-reserve/rsc` — DashboardWidgetServer

## Quick Start

```ts
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [/* your existing collections */],
  plugins: [payloadReserve()],
})
```

The plugin creates 5 collections (Services, Resources, Schedules, Reservations, Customers) and adds a dashboard widget, calendar list view, and availability admin view. All collections appear under the **"Reservations"** group in the admin panel. The plugin does **not** modify your existing users collection.

**Peer dependency**: `payload ^3.76.1`

## Configuration

All options are optional — the plugin works out of the box.

```ts
payloadReserve({
  disabled: false,                    // disable plugin (collections still registered)
  slugs: {
    services: 'services',             // override collection slugs
    resources: 'resources',
    schedules: 'schedules',
    reservations: 'reservations',
    customers: 'customers',
    media: 'media',                   // media collection for Resources image field
  },
  adminGroup: 'Reservations',        // admin panel group name
  defaultBufferTime: 0,              // minutes between reservations (fallback)
  cancellationNoticePeriod: 24,      // minimum hours notice for cancellation
  access: {                          // per-collection access control overrides
    services: { read: () => true },
    resources: { /* ... */ },
    schedules: { /* ... */ },
    reservations: { /* ... */ },
    customers: { /* ... */ },
  },
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `disabled` | `false` | Disable plugin functionality |
| `slugs.*` | `services`, `resources`, `schedules`, `reservations`, `customers`, `media` | Collection slugs |
| `adminGroup` | `'Reservations'` | Admin panel group |
| `defaultBufferTime` | `0` | Default buffer minutes between bookings |
| `cancellationNoticePeriod` | `24` | Minimum hours notice for cancellation |
| `access` | `{}` | Per-collection access control overrides |

## Collection Relationships

```
Services <--many-to-many-- Resources
                              |
                         has schedule
                              |
                          Schedules

Reservations --> Service
             --> Resource
             --> Customer
```

- **Resources** reference **Services** (hasMany) — which services a resource can perform
- **Schedules** belong to a **Resource** — when the resource is available
- **Reservations** reference a Service, Resource, and Customer
- **Customers** is a dedicated auth collection — has JWT auth endpoints but no admin panel access

For full field schemas, see [references/collections.md](references/collections.md).

## Status State Machine

```
              +-> confirmed --+-> completed
              |               |
pending ------+               +-> cancelled
              |               |
              +-> cancelled   +-> no-show
```

- **On create (public)**: Must be `pending`
- **On create (admin)**: Can be `pending` or `confirmed` (walk-in support)
- **Terminal states** (`completed`, `cancelled`, `no-show`): No further transitions

For hook details, conflict detection algorithm, cancellation policy, and escape hatch, see [references/hooks-and-status.md](references/hooks-and-status.md).

## Customization Patterns

### Adding Fields After Plugin

Add fields to plugin collections after the plugin runs using another plugin or config manipulation:

```ts
export default buildConfig({
  plugins: [
    payloadReserve(),
    // Add fields to reservations after the plugin
    (config) => {
      const reservations = config.collections?.find(c => c.slug === 'reservations')
      if (reservations) {
        reservations.fields.push({ name: 'internalNotes', type: 'textarea' })
      }
      return config
    },
  ],
})
```

### Custom afterChange Hooks

Add hooks to plugin collections for notifications, integrations, etc.:

```ts
// In a plugin that runs after payloadReserve()
const reservations = config.collections?.find(c => c.slug === 'reservations')
if (reservations) {
  if (!reservations.hooks) reservations.hooks = {}
  if (!reservations.hooks.afterChange) reservations.hooks.afterChange = []
  reservations.hooks.afterChange.push(myNotificationHook)
}
```

### Access Control for Public Booking

Pass `access` overrides in plugin config to enable public booking. See [references/frontend-booking.md](references/frontend-booking.md) for a complete step-by-step guide.

### Custom Slug Example

```ts
payloadReserve({
  slugs: {
    services: 'salon-services',
    resources: 'stylists',
    schedules: 'stylist-schedules',
    reservations: 'appointments',
    customers: 'clients',
  },
})
```

Components access slugs via `config.admin.custom.reservationSlugs`.

## Admin Components

- **DashboardWidget** (RSC): Today's stats (total, upcoming, completed, cancelled, next appointment). Registered as modular dashboard widget with slug `reservation-todays-reservations`.
- **CalendarView** (Client): Month/week/day CSS Grid calendar replacing Reservations list view. Color-coded by status. Click-to-create, event tooltips, current time indicator.
- **CustomerField** (Client): Rich customer picker with multi-field search (firstName, lastName, phone, email), inline create/edit via document drawer.
- **AvailabilityOverview** (Client): Weekly resource availability grid at `/admin/reservation-availability`. Green=available, blue=booked, gray=exception.

## Utility Exports

Available from `payload-reserve` (server-side):

| Function | Purpose |
|----------|---------|
| `addMinutes(date, minutes)` | Add minutes to a Date |
| `doRangesOverlap(startA, endA, startB, endB)` | Check time range overlap |
| `computeBlockedWindow(start, end, bufferBefore, bufferAfter)` | Compute blocked window with buffers |
| `hoursUntil(futureDate, now?)` | Hours between now and future date |
| `resolveScheduleForDate(schedule, date)` | Resolve concrete time ranges for a date |
| `combineDateAndTime(date, time)` | Merge date + "HH:mm" string |
| `isExceptionDate(date, exceptions)` | Check if date is an exception |

## Troubleshooting

**Conflict detection not catching overlaps**: Check that `bufferTimeBefore`/`bufferTimeAfter` are set on the Service. The plugin falls back to `defaultBufferTime` (default: 0) if not set.

**Status transition errors**: Only valid transitions are allowed. Check the state machine diagram above. Use `context: { skipReservationHooks: true }` for migrations/seeding.

**Cancellation rejected**: The `cancellationNoticePeriod` (default: 24h) blocks late cancellations. Use the escape hatch for automated cleanup.

**Customer cannot log into admin panel**: This is by design. The Customers collection has `access.admin: () => false`. Customers authenticate via REST API endpoints (`/api/customers/login`) for customer-facing pages.

**endTime not updating**: endTime is auto-calculated from `startTime + service.duration`. Ensure the service has a `duration` value. The field is read-only.

## Deep Dives

- **Full collection schemas**: [references/collections.md](references/collections.md)
- **Hook details, state machine, escape hatch**: [references/hooks-and-status.md](references/hooks-and-status.md)
- **Frontend booking integration guide**: [references/frontend-booking.md](references/frontend-booking.md)
- **Stripe, notifications, scheduled cleanup**: [references/integration-patterns.md](references/integration-patterns.md)

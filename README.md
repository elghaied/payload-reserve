# payload-reserve

A full-featured reservation and booking plugin for Payload CMS 3.x. Adds a scheduling system with conflict detection, a configurable status machine, multi-resource bookings, capacity and inventory tracking, a public REST API, and admin UI components.

Designed for salons, clinics, hotels, restaurants, event venues, and any business that needs appointment scheduling managed through Payload's admin panel.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [Collections](#collections)
  - [Services](#services)
  - [Resources](#resources)
  - [Schedules](#schedules)
  - [Customers](#customers)
  - [Reservations](#reservations)
- [Status Machine](#status-machine)
- [Duration Types](#duration-types)
- [Multi-Resource Bookings](#multi-resource-bookings)
- [Capacity and Inventory](#capacity-and-inventory)
- [Plugin Hooks API](#plugin-hooks-api)
- [Public API Endpoints](#public-api-endpoints)
- [Admin Components](#admin-components)
- [Use Case Examples](#use-case-examples)
- [Performance: Recommended Indexes](#performance-recommended-indexes)
- [Reconciliation Job](#reconciliation-job)
- [Integration Examples](#integration-examples)
- [Business Logic Hooks](#business-logic-hooks)
- [Development](#development)
- [Project Structure](#project-structure)

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
- **Public REST API** — Four pre-built endpoints for availability checking, slot listing, booking, and cancellation
- **Calendar View** — Month/week/day calendar replacing the default reservations list view
- **Dashboard Widget** — Server component showing today's booking stats
- **Availability Overview** — Weekly grid of resource availability vs. booked slots
- **Recurring and Manual Schedules** — Weekly patterns with exception dates, or specific one-off dates
- **Localization Support** — Collection fields can be localized when Payload localization is enabled
- **Type-Safe** — Full TypeScript support with exported types

---

## Installation

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependency:** `payload ^3.37.0`

---

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

The plugin registers the domain collections, adds a dashboard widget, replaces the reservations list view with a calendar, and mounts the public API endpoints. All plugin collections appear under the **"Reservations"** admin group by default.

By default, the plugin creates a standalone `customers` auth collection. To use your existing users collection instead, set the `userCollection` option.

---

## Configuration Reference

All options are optional. The plugin works with sensible defaults.

```typescript
import { payloadReserve } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'

payloadReserve({
  // Disable the plugin entirely while keeping the config type-safe
  disabled: false,

  // Admin group label for all reservation collections
  adminGroup: 'Reservations',

  // Minutes of buffer between reservations when a service has none defined
  defaultBufferTime: 0,

  // Minimum hours of notice required before a cancellation is allowed
  cancellationNoticePeriod: 24,

  // Extend an existing auth collection instead of creating a standalone Customers collection.
  // The named collection must exist in your Payload config before the plugin runs.
  userCollection: 'users',

  // Override collection slugs
  slugs: {
    services: 'services',
    resources: 'resources',
    schedules: 'schedules',
    reservations: 'reservations',
    customers: 'customers',
    media: 'media',
  },

  // Override access control per collection
  access: {
    services: {
      read: () => true,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
    },
    resources: { read: () => true },
    schedules: { read: () => true },
    reservations: { create: () => true },
    customers: { create: () => true },
  },

  // Configurable status machine
  statusMachine: {
    statuses: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    defaultStatus: 'pending',
    terminalStatuses: ['completed', 'cancelled', 'no-show'],
    blockingStatuses: ['pending', 'confirmed'],
    transitions: {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled', 'no-show'],
      completed: [],
      cancelled: [],
      'no-show': [],
    },
  },

  // Plugin hook callbacks — see Plugin Hooks API section
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        // Send confirmation email, etc.
      },
    ],
  },
})
```

### Configuration Defaults

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable plugin functionality |
| `adminGroup` | `string` | `'Reservations'` | Admin panel group label |
| `defaultBufferTime` | `number` | `0` | Default buffer between bookings (minutes) |
| `cancellationNoticePeriod` | `number` | `24` | Minimum hours notice for cancellation |
| `userCollection` | `string` | `undefined` | Existing auth collection slug to extend |
| `slugs.services` | `string` | `'services'` | Services collection slug |
| `slugs.resources` | `string` | `'resources'` | Resources collection slug |
| `slugs.schedules` | `string` | `'schedules'` | Schedules collection slug |
| `slugs.reservations` | `string` | `'reservations'` | Reservations collection slug |
| `slugs.customers` | `string` | `'customers'` | Customers collection slug |
| `slugs.media` | `string` | `'media'` | Media collection slug (used by image fields) |
| `statusMachine` | `Partial<StatusMachineConfig>` | Default 5-status machine | Custom status machine |
| `hooks` | `ReservationPluginHooks` | `{}` | Plugin hook callbacks |

---

## Collections

### Services

**Slug:** `services`

Defines what can be booked (e.g., "Haircut", "Consultation", "Massage").

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Service name (max 200 chars) |
| `image` | Upload | No | Service image |
| `description` | Textarea | No | Service description |
| `duration` | Number | Yes | Duration in minutes (min: 1) |
| `durationType` | Select | Yes | `'fixed'`, `'flexible'`, or `'full-day'` (default: `'fixed'`) |
| `price` | Number | No | Price (min: 0, step: 0.01) |
| `bufferTimeBefore` | Number | No | Buffer minutes before the slot (default: 0) |
| `bufferTimeAfter` | Number | No | Buffer minutes after the slot (default: 0) |
| `active` | Checkbox | No | Whether service is bookable (default: true) |

```typescript
await payload.create({
  collection: 'services',
  data: {
    name: 'Haircut',
    duration: 30,
    durationType: 'fixed',
    price: 35.00,
    bufferTimeBefore: 5,
    bufferTimeAfter: 10,
    active: true,
  },
})
```

### Resources

**Slug:** `resources`

Who or what performs the service (a stylist, a room, a machine, a yoga instructor).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Resource name (max 200 chars) |
| `image` | Upload | No | Resource photo |
| `description` | Textarea | No | Resource description |
| `services` | Relationship | Yes | Services this resource can perform (hasMany) |
| `active` | Checkbox | No | Whether resource accepts bookings (default: true) |
| `quantity` | Number | Yes | How many concurrent bookings allowed (default: 1) |
| `capacityMode` | Select | No | `'per-reservation'` or `'per-guest'` — shown only when `quantity > 1` |
| `timezone` | Text | No | IANA timezone for display purposes |

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Room 101',
    services: [conferenceServiceId],
    quantity: 1,
    active: true,
  },
})
```

### Schedules

**Slug:** `schedules`

Defines when a resource is available. Supports **recurring** (weekly pattern) and **manual** (specific dates) types, plus exception dates.

| Field | Type | Description |
|-------|------|-------------|
| `name` | Text | Schedule name |
| `resource` | Relationship | Which resource this schedule belongs to |
| `scheduleType` | Select | `'recurring'` or `'manual'` (default: `'recurring'`) |
| `recurringSlots` | Array | Weekly slots with `day`, `startTime`, `endTime` |
| `manualSlots` | Array | Specific date slots with `date`, `startTime`, `endTime` |
| `exceptions` | Array | Dates the resource is unavailable (`date`, `reason`) |
| `active` | Checkbox | Whether this schedule is in effect (default: true) |

Times use `HH:mm` format (24-hour). Exception dates block out the entire day.

```typescript
await payload.create({
  collection: 'schedules',
  data: {
    name: 'Alice - Standard Week',
    resource: aliceId,
    scheduleType: 'recurring',
    recurringSlots: [
      { day: 'mon', startTime: '09:00', endTime: '17:00' },
      { day: 'tue', startTime: '09:00', endTime: '17:00' },
      { day: 'wed', startTime: '09:00', endTime: '17:00' },
      { day: 'thu', startTime: '09:00', endTime: '17:00' },
      { day: 'fri', startTime: '09:00', endTime: '15:00' },
    ],
    exceptions: [
      { date: '2025-12-25', reason: 'Christmas' },
    ],
    active: true,
  },
})
```

### Customers

**Slug:** `customers` (or your `userCollection` slug)

Either a standalone auth collection (default) or fields injected into your existing auth collection when `userCollection` is set.

**Standalone mode (default):** A dedicated auth collection with `auth: true` for customer JWT login. Has `access.admin: () => false` to block customers from the admin panel.

**User collection mode (`userCollection` set):** The plugin injects `phone`, `notes`, and a `bookings` join field into your existing auth collection. No new collection is created.

| Field | Type | Description |
|-------|------|-------------|
| `email` | Email | Customer email (from Payload auth) |
| `firstName` | Text | First name (standalone mode only) |
| `lastName` | Text | Last name (standalone mode only) |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal notes visible only to admins |
| `bookings` | Join | Virtual field — all reservations for this customer |

### Reservations

**Slug:** `reservations`

The core booking records. Each reservation links a customer to a service performed by a resource.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Service being booked |
| `resource` | Relationship | Yes | Resource performing the service |
| `customer` | Relationship | Yes | Customer making the booking |
| `startTime` | Date | Yes | Appointment start (date + time picker) |
| `endTime` | Date | No | Auto-calculated from service duration (read-only) |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `guestCount` | Number | No | Number of guests (default: 1, min: 1) |
| `cancellationReason` | Textarea | No | Visible only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |
| `items` | Array | No | Additional resources in a multi-resource booking |
| `idempotencyKey` | Text | No | Unique key to prevent duplicate submissions |

---

## Status Machine

The plugin ships with a default 5-status machine. You can replace it entirely or override individual properties using the `statusMachine` option.

### Default Machine

```
pending ---> confirmed ---> completed
        \               \-> cancelled
         \               \-> no-show
          \-> cancelled
```

| Status | Meaning | Terminal |
|--------|---------|----------|
| `pending` | Created, awaiting confirmation | No |
| `confirmed` | Confirmed and time slot committed | No |
| `completed` | Service was delivered | Yes |
| `cancelled` | Cancelled before the appointment | Yes |
| `no-show` | Customer did not show up | Yes |

Terminal statuses cannot transition to anything. Once a reservation is terminal, it is permanently closed.

`blockingStatuses` controls which statuses count as occupying the time slot for conflict detection. By default both `pending` and `confirmed` block the slot.

### Custom Status Machine

```typescript
payloadReserve({
  statusMachine: {
    statuses: ['requested', 'approved', 'in-progress', 'done', 'cancelled'],
    defaultStatus: 'requested',
    terminalStatuses: ['done', 'cancelled'],
    blockingStatuses: ['approved', 'in-progress'],
    transitions: {
      requested: ['approved', 'cancelled'],
      approved: ['in-progress', 'cancelled'],
      'in-progress': ['done', 'cancelled'],
      done: [],
      cancelled: [],
    },
  },
})
```

The `statuses` array drives the select field options in the admin UI. The `transitions` map controls which updates the `validateStatusTransition` hook allows. The `blockingStatuses` array determines which statuses occupy the time slot in conflict detection.

### Escape Hatch

All hooks check `context.skipReservationHooks` and skip all validation if truthy. Use this for data migrations, seeding, and administrative operations:

```typescript
await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    status: 'completed', // bypasses status transition check
  },
  context: { skipReservationHooks: true },
})
```

---

## Duration Types

Set on each service via the `durationType` field.

### Fixed (default)

`endTime = startTime + service.duration`

The standard appointment mode. The service duration is fixed and always applied. Used for haircuts, consultations, classes with defined runtimes.

```typescript
{ duration: 60, durationType: 'fixed' }
// A 60-minute appointment — endTime is always startTime + 60 min
```

### Flexible

`endTime` is provided by the caller in the booking request. The service `duration` field acts as the minimum; if the provided `endTime` results in less than `duration` minutes the booking is rejected.

Used for open-ended services where the customer specifies how long they need — workspace rentals, recording studios, vehicle bays.

```typescript
{ duration: 30, durationType: 'flexible' }
// Minimum 30 minutes, but the caller can book 90 minutes by providing endTime
```

When creating a flexible booking, pass both `startTime` and `endTime`:

```typescript
await payload.create({
  collection: 'reservations',
  data: {
    service: flexibleServiceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    endTime: '2025-06-15T12:30:00.000Z', // 2.5 hours
  },
})
```

### Full-Day

`endTime = end of the calendar day (23:59:59)` relative to `startTime`.

Used for day-rate resources: hotel rooms, venue hire, equipment daily rental.

```typescript
{ duration: 480, durationType: 'full-day' }
// Always occupies the entire day, regardless of start time
```

---

## Multi-Resource Bookings

A single reservation can include multiple resources simultaneously using the `items` array. This is used for bookings that require a combination of resources — a couple's massage (two therapists), a wedding (venue + catering team), a film shoot (studio + equipment set).

The top-level `service`, `resource`, and `startTime` fields represent the primary booking. Additional resources go in the `items` array:

```typescript
await payload.create({
  collection: 'reservations',
  data: {
    service: primaryServiceId,
    resource: primaryResourceId,
    customer: customerId,
    startTime: '2025-06-15T14:00:00.000Z',
    items: [
      {
        resource: secondResourceId,
        service: secondServiceId,
        startTime: '2025-06-15T14:00:00.000Z',
        endTime: '2025-06-15T15:00:00.000Z',
        guestCount: 2,
      },
      {
        resource: thirdResourceId,
        // service is optional — inherit primary if omitted
      },
    ],
  },
})
```

Each item in the `items` array has its own `resource`, optional `service`, optional `startTime`/`endTime` (for staggered scheduling), and optional `guestCount`.

Conflict detection runs independently for each resource in the `items` array as well as the primary resource.

---

## Capacity and Inventory

By default, each resource allows only one concurrent booking. Set `quantity > 1` to enable inventory mode.

### quantity

The number of concurrent bookings the resource can accept for overlapping time windows.

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Standard Room',
    services: [hotelNightId],
    quantity: 20, // 20 identical rooms
    capacityMode: 'per-reservation',
  },
})
```

With `quantity: 20`, up to 20 reservations can overlap. The 21st booking for the same time window is rejected.

### capacityMode

Controls how the `quantity` limit is counted. Only relevant when `quantity > 1`.

**`per-reservation` (default):** Each booking occupies one unit, regardless of how many guests it contains. Use this for hotel rooms, parking spaces, equipment units, or any resource where each booking takes one slot.

```
quantity: 5 allows 5 simultaneous bookings
Booking with guestCount: 3 still occupies 1 slot
```

**`per-guest`:** Each booking occupies `guestCount` units. Use this for group venues, yoga classes, boat tours, or any resource with a total people capacity.

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Yoga Studio',
    services: [yogaClassId],
    quantity: 20,       // 20 total spots
    capacityMode: 'per-guest',
  },
})

// Booking with guestCount: 3 occupies 3 of the 20 spots
// When 20 total guests are booked, the class is full
```

---

## Plugin Hooks API

The plugin exposes hook callbacks that fire at key points in the booking lifecycle. Register them in the `hooks` option. All hooks receive the `req` object (Payload request) so you have access to the full Payload instance and request context.

```typescript
import type { ReservationPluginHooks } from 'payload-reserve'

const hooks: ReservationPluginHooks = {
  // ... hook definitions
}

payloadReserve({ hooks })
```

### beforeBookingCreate

Fires before a new reservation is saved. Can modify the booking data.

```typescript
type beforeBookingCreate = Array<
  (args: {
    data: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<Record<string, unknown>> | Record<string, unknown>
>
```

Return the (optionally modified) data. Returning `undefined` keeps the original data.

```typescript
hooks: {
  beforeBookingCreate: [
    async ({ data, req }) => {
      // Attach the logged-in user as the customer
      if (req.user && !data.customer) {
        return { ...data, customer: req.user.id }
      }
      return data
    },
  ],
}
```

### beforeBookingConfirm

Fires before a reservation transitions to `confirmed`.

```typescript
type beforeBookingConfirm = Array<
  (args: {
    doc: Record<string, unknown>
    newStatus: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  beforeBookingConfirm: [
    async ({ doc, req }) => {
      // Verify payment before confirming
      const paid = await checkPaymentStatus(doc.stripeSessionId as string)
      if (!paid) {
        throw new Error('Payment not completed')
      }
    },
  ],
}
```

### beforeBookingCancel

Fires before a reservation transitions to `cancelled`.

```typescript
type beforeBookingCancel = Array<
  (args: {
    doc: Record<string, unknown>
    reason?: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  beforeBookingCancel: [
    async ({ doc, reason }) => {
      await notifyResourceOfCancellation(doc, reason)
    },
  ],
}
```

### afterBookingCreate

Fires after a new reservation is saved to the database.

```typescript
type afterBookingCreate = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingCreate: [
    async ({ doc, req }) => {
      await sendBookingConfirmationEmail(doc)
      await slackNotify(`New booking: ${doc.id}`)
    },
  ],
}
```

### afterBookingConfirm

Fires after a reservation transitions to `confirmed`.

```typescript
type afterBookingConfirm = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingConfirm: [
    async ({ doc }) => {
      await sendConfirmationEmail(doc)
      await addToCalendar(doc)
    },
  ],
}
```

### afterBookingCancel

Fires after a reservation transitions to `cancelled`.

```typescript
type afterBookingCancel = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingCancel: [
    async ({ doc }) => {
      await sendCancellationEmail(doc)
      await releaseStripeHold(doc.stripePaymentIntentId as string)
    },
  ],
}
```

### afterStatusChange

Generic hook that fires on every status transition.

```typescript
type afterStatusChange = Array<
  (args: {
    doc: Record<string, unknown>
    newStatus: string
    previousStatus: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterStatusChange: [
    async ({ doc, newStatus, previousStatus }) => {
      console.log(`Reservation ${doc.id}: ${previousStatus} -> ${newStatus}`)
      await auditLog.record({ docId: doc.id, event: 'status_change', newStatus, previousStatus })
    },
  ],
}
```

---

## Public API Endpoints

The plugin mounts four endpoints under `/api/reserve/`. These are Payload custom endpoints — they respect the same access control as the rest of the API.

### GET /api/reserve/availability

Returns available time slots for a resource and service on a given date. This is a convenience alias for the slots endpoint with a simpler response shape.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | Resource ID |
| `service` | Yes | Service ID |
| `date` | Yes | Date in `YYYY-MM-DD` format |

**Example request:**

```
GET /api/reserve/availability?resource=abc123&service=def456&date=2025-06-15
```

**Response:**

```json
{
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" },
    { "start": "2025-06-15T10:30:00.000Z", "end": "2025-06-15T11:00:00.000Z" }
  ]
}
```

Slots are derived from the resource's active schedules for that date minus any overlapping reservations with blocking statuses.

### GET /api/reserve/slots

Returns available slots with richer metadata. Accepts an optional `guestCount` parameter for capacity-aware filtering.

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `resource` | Yes | — | Resource ID |
| `service` | Yes | — | Service ID |
| `date` | Yes | — | Date in `YYYY-MM-DD` format |
| `guestCount` | No | `1` | Number of guests (used for `per-guest` capacity mode) |

**Example request:**

```
GET /api/reserve/slots?resource=abc123&service=def456&date=2025-06-15&guestCount=2
```

**Response:**

```json
{
  "date": "2025-06-15",
  "guestCount": 2,
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" }
  ]
}
```

Returns `400` with `{ "error": "..." }` if required parameters are missing or the date is invalid.

### POST /api/reserve/book

Creates a new reservation. All Payload collection hooks (conflict detection, end time calculation, status transition validation) run as normal. Runs any registered `beforeBookingCreate` plugin hooks before saving.

**Request body:** Same as `payload.create` data for the reservations collection.

```json
{
  "service": "def456",
  "resource": "abc123",
  "customer": "cus789",
  "startTime": "2025-06-15T10:00:00.000Z",
  "guestCount": 1,
  "notes": "Please use the side entrance.",
  "idempotencyKey": "frontend-uuid-or-form-id"
}
```

**Response:** `201` with the created reservation document, or `400`/`409` if validation fails.

The `idempotencyKey` field prevents duplicate submissions — if a key has already been used, the request is rejected with a validation error.

### POST /api/reserve/cancel

Cancels a reservation. Requires an authenticated session (`req.user`).

**Request body:**

```json
{
  "reservationId": "res123",
  "reason": "Change of plans"
}
```

**Response:** `200` with the updated reservation document.

Returns `401` if not authenticated, `400` if `reservationId` is missing. The `validateCancellation` hook enforces the minimum notice period configured in `cancellationNoticePeriod`.

---

## Admin Components

### Calendar View

Replaces the default Reservations list view with a CSS Grid-based calendar (no external dependencies).

**View modes:** Month, Week, Day — switchable in the header toolbar.

**Features:**
- Color-coded reservations by status (configurable when using a custom status machine)
- Click any empty cell to open a create drawer with the time pre-filled
- Click any reservation chip to open its edit drawer
- Hover tooltips showing service, time range, customer, resource, and status
- Current time indicator (red line) in week and day views
- Status legend below the toolbar

Status colors are derived from the status machine configuration exposed via `config.admin.custom.reservationStatusMachine`.

### Dashboard Widget

A Payload modular dashboard widget (RSC) that shows today's booking statistics:

- Total reservations today
- Upcoming (not yet completed or cancelled)
- Completed
- Cancelled
- Next appointment time and status

The widget uses the Payload Local API server-side — no HTTP round-trip. It respects the configured `reservations` slug.

**Widget slug:** `reservation-todays-reservations`

### Availability Overview

A custom admin view at `/admin/reservation-availability`. Displays a weekly grid:

- **Rows** — active resources
- **Columns** — days of the current week
- **Green slots** — available windows (from schedules)
- **Blue slots** — booked windows (from reservations)
- **Gray** — exception dates (unavailable)

Navigate between weeks with previous/next buttons. Shows remaining capacity for multi-unit resources.

---

## Use Case Examples

### Salon / Barbershop

Staff are resources, services are treatments. Each stylist has their own recurring weekly schedule.

```typescript
payloadReserve({
  adminGroup: 'Salon',
  defaultBufferTime: 0,
  cancellationNoticePeriod: 24,
  slugs: {
    resources: 'stylists',
    services: 'treatments',
    reservations: 'appointments',
  },
})
```

Typical services: `duration: 30, durationType: 'fixed', bufferTimeAfter: 10`

### Hotel

Rooms are resources with `quantity` equal to the number of identical rooms of that type. Each guest stays for a full calendar day — use `full-day` duration.

```typescript
payloadReserve({
  adminGroup: 'Hotel',
  cancellationNoticePeriod: 48,
  slugs: {
    resources: 'rooms',
    services: 'room-types',
    reservations: 'bookings',
  },
})

// Room type service
await payload.create({
  collection: 'room-types',
  data: {
    name: 'Standard Double',
    duration: 1440,
    durationType: 'full-day',
    price: 149.00,
  },
})

// Room resource (10 identical standard doubles)
await payload.create({
  collection: 'rooms',
  data: {
    name: 'Standard Double',
    services: [standardDoubleId],
    quantity: 10,
    capacityMode: 'per-reservation',
  },
})
```

### Restaurant / Event Space

Group bookings where total guest count matters. Use `per-guest` capacity mode with a maximum party size enforced via `guestCount`.

```typescript
payloadReserve({
  adminGroup: 'Restaurant',
  cancellationNoticePeriod: 2,
})

// Dining room resource (max 60 guests total)
await payload.create({
  collection: 'resources',
  data: {
    name: 'Main Dining Room',
    services: [diningServiceId],
    quantity: 60,
    capacityMode: 'per-guest',
  },
})
```

Bookings with `guestCount: 4` occupy 4 of the 60 total seats. The room is full when total booked guests reach 60.

### Event Venue (Custom Status Machine)

Events go through an approval workflow before being confirmed. Use a custom status machine.

```typescript
payloadReserve({
  adminGroup: 'Events',
  statusMachine: {
    statuses: ['enquiry', 'quote-sent', 'deposit-paid', 'confirmed', 'completed', 'cancelled'],
    defaultStatus: 'enquiry',
    terminalStatuses: ['completed', 'cancelled'],
    blockingStatuses: ['deposit-paid', 'confirmed'],
    transitions: {
      enquiry: ['quote-sent', 'cancelled'],
      'quote-sent': ['deposit-paid', 'cancelled'],
      'deposit-paid': ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    },
  },
  hooks: {
    afterStatusChange: [
      async ({ doc, newStatus }) => {
        if (newStatus === 'quote-sent') {
          await sendQuoteEmail(doc)
        }
        if (newStatus === 'confirmed') {
          await sendContractEmail(doc)
        }
      },
    ],
  },
})
```

---

## Performance: Recommended Indexes

For production deployments with high booking volume, add these indexes to your database. The exact syntax depends on your Payload DB adapter.

### MongoDB

```js
db.reservations.createIndex(
  { resource: 1, status: 1, startTime: 1, endTime: 1 },
  { name: 'reservation_conflict_lookup' }
)
db.reservations.createIndex(
  { customer: 1, startTime: -1 },
  { name: 'reservation_customer_history' }
)
db.reservations.createIndex(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'reservation_idempotency' }
)
```

### PostgreSQL

```sql
CREATE INDEX reservation_conflict_lookup
  ON reservations (resource, status, "startTime", "endTime");
CREATE INDEX reservation_customer_history
  ON reservations (customer, "startTime" DESC);
CREATE UNIQUE INDEX reservation_idempotency
  ON reservations ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
```

### SQLite

```sql
CREATE INDEX reservation_conflict_lookup
  ON reservations (resource, status, startTime, endTime);
```

The conflict detection query filters by `resource`, `status`, `startTime`, and `endTime` on every create and update — the composite `reservation_conflict_lookup` index covers this query exactly and is the most important one to add.

The `idempotencyKey` field has a `unique: true` index in the Payload schema definition, so Payload-managed databases will have this automatically. The snippets above are for manually adding it if your database was created before this field was introduced.

---

## Reconciliation Job

For high-concurrency deployments, rare race conditions between two simultaneous bookings can slip past the hook-level conflict check. A background reconciliation job can detect and flag these after the fact.

Add this to your Payload config's `jobs.tasks` array:

```typescript
import type { TaskConfig } from 'payload'

export const reconcileReservations: TaskConfig = {
  slug: 'reconcile-reservations',
  handler: async ({ req }) => {
    // Find all active reservations grouped by resource
    const { docs: activeReservations } = await req.payload.find({
      collection: 'reservations',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      req,
      where: {
        status: { in: ['pending', 'confirmed'] },
      },
    })

    // Group by resource and detect overlaps
    const byResource = new Map<string, typeof activeReservations>()
    for (const reservation of activeReservations) {
      const resourceId = String(reservation.resource)
      if (!byResource.has(resourceId)) {
        byResource.set(resourceId, [])
      }
      byResource.get(resourceId)!.push(reservation)
    }

    let conflictCount = 0
    for (const [, reservations] of byResource) {
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          const a = reservations[i]
          const b = reservations[j]
          const aStart = new Date(a.startTime as string)
          const aEnd = new Date(a.endTime as string)
          const bStart = new Date(b.startTime as string)
          const bEnd = new Date(b.endTime as string)
          if (aStart < bEnd && aEnd > bStart) {
            conflictCount++
            // Flag or alert — e.g., add a note, send a Slack message, etc.
            console.warn(`Conflict detected: ${a.id} overlaps ${b.id}`)
          }
        }
      }
    }

    return { output: { conflicts: conflictCount } }
  },
}
```

Run this job on a schedule (e.g., hourly) using Payload's job queue. The job does not resolve conflicts automatically — it flags them for human review.

---

## Integration Examples

### Stripe Payment Gate

Hold the time slot with a `pending` reservation while the customer pays. Confirm on successful payment.

```typescript
// 1. Create reservation on your booking page (slot is held, conflict detection runs)
const reservation = await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: selectedSlot,
  },
  // status defaults to 'pending'
})

// 2. Create a Stripe Checkout Session with the reservation ID in metadata
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: stripePriceId, quantity: 1 }],
  metadata: { reservationId: String(reservation.id) },
  mode: 'payment',
  success_url: `${process.env.NEXT_PUBLIC_URL}/booking/success`,
  cancel_url: `${process.env.NEXT_PUBLIC_URL}/booking/cancel`,
})

// 3. In your Stripe webhook handler, confirm the reservation
// app/api/stripe-webhook/route.ts
export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const reservationId = session.metadata?.reservationId

    if (reservationId) {
      const payload = await getPayload({ config })
      await payload.update({
        collection: 'reservations',
        id: reservationId,
        data: { status: 'confirmed' },
        context: { skipReservationHooks: false }, // hooks run — validates transition
      })
    }
  }

  return new Response('OK', { status: 200 })
}
```

### Email Notifications

Use `afterBookingCreate` and `afterStatusChange` hooks to send transactional emails:

```typescript
payloadReserve({
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        const customer = await req.payload.findByID({
          collection: 'customers',
          id: doc.customer as string,
          depth: 0,
          req,
        })
        await sendEmail({
          subject: 'Booking received',
          template: 'booking-created',
          to: customer.email as string,
          variables: { bookingId: doc.id, startTime: doc.startTime },
        })
      },
    ],
    afterStatusChange: [
      async ({ doc, newStatus, req }) => {
        if (newStatus === 'confirmed') {
          await sendEmail({ template: 'booking-confirmed', variables: doc })
        }
        if (newStatus === 'cancelled') {
          await sendEmail({ template: 'booking-cancelled', variables: doc })
        }
      },
    ],
  },
})
```

### Multi-Tenant Deployments

Scope all queries to a tenant using `beforeBookingCreate` to inject tenant metadata, and access control functions to filter by tenant:

```typescript
payloadReserve({
  access: {
    reservations: {
      read: ({ req }) => {
        if (!req.user) {return false}
        return { tenant: { equals: req.user.tenant } }
      },
      create: ({ req }) => !!req.user,
    },
  },
  hooks: {
    beforeBookingCreate: [
      async ({ data, req }) => {
        // Inject tenant ID from the authenticated user
        return { ...data, tenant: req.user?.tenant }
      },
    ],
  },
})
```

---

## Business Logic Hooks

Four `beforeChange` hooks run on the Reservations collection in order on every create and update:

1. **`checkIdempotency`** — Rejects creates where `idempotencyKey` has already been used.
2. **`calculateEndTime`** — Computes `endTime` from `startTime + service.duration` (respects `durationType`).
3. **`validateConflicts`** — Checks for overlapping reservations on the same resource using blocking statuses and buffer times.
4. **`validateStatusTransition`** — Enforces allowed transitions defined in the status machine. On create, enforces that new public bookings start in `defaultStatus`.
5. **`validateCancellation`** — When transitioning to `cancelled`, verifies the appointment is at least `cancellationNoticePeriod` hours away.

All hooks skip processing when `context.skipReservationHooks` is truthy.

---

## Development

### Prerequisites

- Node.js `^18.20.2` or `>=20.9.0`
- pnpm `^9` or `^10`

### Commands

```bash
pnpm dev                    # Start dev server (Next.js + in-memory MongoDB)
pnpm build                  # Build for distribution
pnpm test:int               # Run integration tests (Vitest)
pnpm test:e2e               # Run E2E tests (Playwright, requires dev server)
pnpm test                   # Both test suites
pnpm lint                   # ESLint check
pnpm lint:fix               # ESLint auto-fix
pnpm dev:generate-types     # Regenerate payload-types.ts after schema changes
pnpm dev:generate-importmap # Regenerate import map after adding components
```

Run a single test by pattern: `pnpm vitest -t "conflict detection"`

---

## Project Structure

```
src/
  index.ts              # Public API: re-exports plugin + types
  plugin.ts             # Main plugin factory function
  types.ts              # All TypeScript types + DEFAULT_STATUS_MACHINE
  defaults.ts           # Default config values + resolveConfig()

  collections/
    Services.ts         # Service definitions (name, duration, durationType, price, buffers)
    Resources.ts        # Resources (quantity, capacityMode, timezone)
    Schedules.ts        # Availability schedules (recurring/manual + exceptions)
    Reservations.ts     # Bookings with hooks, guestCount, items, idempotencyKey
    Customers.ts        # Standalone customer auth collection

  hooks/reservations/
    checkIdempotency.ts       # Duplicate submission prevention
    calculateEndTime.ts       # Auto end time from service duration
    validateConflicts.ts      # Double-booking prevention
    validateStatusTransition.ts # Status machine enforcement
    validateCancellation.ts   # Cancellation notice period
    onStatusChange.ts         # afterChange hook — fires plugin hook callbacks

  services/
    AvailabilityService.ts    # computeEndTime, checkAvailability, getAvailableSlots

  endpoints/
    checkAvailability.ts      # GET /api/reserve/availability
    getSlots.ts               # GET /api/reserve/slots
    createBooking.ts          # POST /api/reserve/book
    cancelBooking.ts          # POST /api/reserve/cancel
    customerSearch.ts         # GET /api/reservation-customer-search

  utilities/
    slotUtils.ts              # addMinutes, doRangesOverlap, computeBlockedWindow, hoursUntil
    scheduleUtils.ts          # resolveScheduleForDate, combineDateAndTime, etc.

  components/
    CalendarView/             # Client: month/week/day calendar
    CustomerField/            # Client: rich customer search field
    DashboardWidget/          # RSC: today's reservation stats
    AvailabilityOverview/     # Client: weekly resource grid

  exports/
    client.ts                 # CalendarView, AvailabilityOverview, CustomerField
    rsc.ts                    # DashboardWidgetServer

dev/
  payload.config.ts           # Dev Payload config (MongoDB Memory Server)
  seed.ts                     # Sample salon data
  int.spec.ts                 # Vitest integration tests
  e2e.spec.ts                 # Playwright E2E tests
```

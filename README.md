# payload-reserve - Reservation Plugin for Payload CMS 3.x

A full-featured, reusable reservation/booking plugin for Payload CMS 3.x. Designed for salons, clinics, consultants, and any business that needs appointment scheduling with conflict prevention, status workflows, and admin UI components.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Collections](#collections)
  - [Services](#services)
  - [Resources](#resources)
  - [Schedules](#schedules)
  - [User Collection Extension (Customers)](#user-collection-extension-customers)
  - [Reservations](#reservations)
- [Business Logic Hooks](#business-logic-hooks)
  - [Auto End Time Calculation](#auto-end-time-calculation)
  - [Conflict Detection](#conflict-detection)
  - [Status Transition Enforcement](#status-transition-enforcement)
  - [Common Workflows](#common-workflows)
  - [Cancellation Policy](#cancellation-policy)
  - [Escape Hatch](#escape-hatch)
  - [Integration Patterns](#integration-patterns)
- [Admin UI Components](#admin-ui-components)
  - [Dashboard Widget](#dashboard-widget)
  - [Calendar View](#calendar-view)
  - [Availability Overview](#availability-overview)
- [Utilities](#utilities)
- [Development](#development)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)

---

## Features

- **4 Collections + User Extension** - Services, Resources, Schedules, and Reservations, plus customer fields added to your existing Users collection
- **Double-Booking Prevention** - Automatic conflict detection with configurable buffer times
- **Status State Machine** - Enforced workflow: pending -> confirmed -> completed/cancelled/no-show
- **Auto End Time** - Automatically calculates reservation end time from service duration
- **Cancellation Policy** - Configurable notice period enforcement
- **Admin Quick-Confirm** - Authenticated admin users can create reservations directly as "confirmed" for walk-ins
- **Calendar View** - Month/week/day calendar replacing the default reservations list view
- **Click-to-Create** - Click any calendar cell to create a reservation with the start time pre-filled
- **Event Tooltips** - Hover events to see full details (service, time range, customer, resource, status)
- **Status Legend** - Color key displayed in the calendar explaining each status color
- **Current Time Indicator** - Red line in week/day views marking the current time
- **Dashboard Widget** - Server component showing today's booking stats at a glance
- **Availability Grid** - Weekly overview of resource availability vs. booked slots
- **Recurring & Manual Schedules** - Flexible schedule types with exception dates
- **Fully Configurable** - Override slugs, access control, buffer times, and admin grouping
- **Type-Safe** - Full TypeScript support with exported types

---

## Installation

```bash
# Install the plugin as a dependency
pnpm add payload-reserve

# Or if developing locally, link it
pnpm link ./plugins/payload-reserve
```

**Peer Dependency:** Requires `payload ^3.69.0` (modular dashboard widget API).

---

## Quick Start

Add the plugin to your `payload.config.ts`:

```typescript
import { buildConfig } from 'payload'
import { reservationPlugin } from 'payload-reserve'

export default buildConfig({
  // ... your existing config
  plugins: [
    reservationPlugin(),
  ],
})
```

That's it. The plugin registers 4 collections, extends your existing Users collection with customer fields (`name`, `phone`, `notes`, `bookings`), and adds a dashboard widget, a calendar list view, and an availability admin view automatically. All plugin collections appear under the **"Reservations"** group in the admin panel.

> **Important:** Your Payload config must explicitly define a `users` collection (or whichever collection you specify via `userCollection`). The plugin finds it in `config.collections` and appends customer fields to it.

---

## Configuration

All options are optional. The plugin works out of the box with sensible defaults.

```typescript
import { reservationPlugin } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'

const config: ReservationPluginConfig = {
  // Disable the plugin entirely (collections are still registered for schema consistency)
  disabled: false,

  // Override collection slugs
  slugs: {
    services: 'reservation-services',       // default
    resources: 'reservation-resources',      // default
    schedules: 'reservation-schedules',      // default
    reservations: 'reservations',            // default
  },

  // Slug of the existing auth collection to extend with customer fields
  userCollection: 'users',                   // default

  // Admin panel group name
  adminGroup: 'Reservations',               // default

  // Default buffer time (minutes) between reservations
  // Applied when a service doesn't define its own buffer times
  defaultBufferTime: 0,                     // default

  // Minimum hours of notice required before cancellation
  cancellationNoticePeriod: 24,             // default (hours)

  // Override access control per collection
  access: {
    services: {
      read: () => true,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
    },
    resources: { /* ... */ },
    schedules: { /* ... */ },
    reservations: { /* ... */ },
  },
}

reservationPlugin(config)
```

### Configuration Defaults

| Option | Default | Description |
|--------|---------|-------------|
| `disabled` | `false` | Disable plugin functionality |
| `slugs.services` | `'reservation-services'` | Services collection slug |
| `slugs.resources` | `'reservation-resources'` | Resources collection slug |
| `slugs.schedules` | `'reservation-schedules'` | Schedules collection slug |
| `slugs.reservations` | `'reservations'` | Reservations collection slug |
| `userCollection` | `'users'` | Existing auth collection to extend with customer fields |
| `adminGroup` | `'Reservations'` | Admin panel group name |
| `defaultBufferTime` | `0` | Default buffer (minutes) between bookings |
| `cancellationNoticePeriod` | `24` | Minimum hours notice for cancellation |

---

## Collections

### Services

**Slug:** `reservation-services`

Defines what can be booked (e.g., "Haircut", "Consultation", "Massage").

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Service name (max 200 chars, used as title) |
| `description` | Textarea | No | Service description |
| `duration` | Number | Yes | Duration in minutes (min: 1) |
| `price` | Number | No | Price (min: 0, step: 0.01) |
| `bufferTimeBefore` | Number | No | Buffer minutes before appointment (default: 0) |
| `bufferTimeAfter` | Number | No | Buffer minutes after appointment (default: 0) |
| `active` | Checkbox | No | Whether service is active (default: true, sidebar) |

**Example:**
```typescript
await payload.create({
  collection: 'reservation-services',
  data: {
    name: 'Haircut',
    description: 'Standard haircut service',
    duration: 30,
    price: 35.00,
    bufferTimeBefore: 5,
    bufferTimeAfter: 10,
    active: true,
  },
})
```

### Resources

**Slug:** `reservation-resources`

Who or what performs the service (e.g., a stylist, a room, a consultant).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Resource name (max 200 chars, used as title) |
| `description` | Textarea | No | Resource description |
| `services` | Relationship | Yes | Services this resource can perform (hasMany) |
| `active` | Checkbox | No | Whether resource is active (default: true, sidebar) |

**Example:**
```typescript
await payload.create({
  collection: 'reservation-resources',
  data: {
    name: 'Alice Johnson',
    description: 'Senior Stylist',
    services: [haircutId, coloringId],
    active: true,
  },
})
```

### Schedules

**Slug:** `reservation-schedules`

Defines when a resource is available. Supports **recurring** (weekly pattern) and **manual** (specific dates) modes, plus exception dates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Schedule name (used as title) |
| `resource` | Relationship | Yes | Which resource this schedule belongs to |
| `scheduleType` | Select | No | `'recurring'` or `'manual'` (default: `'recurring'`) |
| `recurringSlots` | Array | No | Weekly slots (shown when type is recurring) |
| `recurringSlots.day` | Select | Yes | Day of week (mon-sun) |
| `recurringSlots.startTime` | Text | Yes | Start time (HH:mm format) |
| `recurringSlots.endTime` | Text | Yes | End time (HH:mm format) |
| `manualSlots` | Array | No | Specific date slots (shown when type is manual) |
| `manualSlots.date` | Date | Yes | Specific date (day only) |
| `manualSlots.startTime` | Text | Yes | Start time (HH:mm format) |
| `manualSlots.endTime` | Text | Yes | End time (HH:mm format) |
| `exceptions` | Array | No | Dates when the resource is unavailable |
| `exceptions.date` | Date | Yes | Exception date (day only) |
| `exceptions.reason` | Text | No | Reason for unavailability |
| `active` | Checkbox | No | Whether schedule is active (default: true, sidebar) |

**Example - Recurring Schedule:**
```typescript
await payload.create({
  collection: 'reservation-schedules',
  data: {
    name: 'Alice - Weekdays',
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

### User Collection Extension (Customers)

Instead of a standalone Customers collection, the plugin extends your **existing auth-enabled Users collection** with customer fields. This means customers are real users who can log in to your site.

The plugin finds the collection specified by `userCollection` (default: `'users'`) and appends these fields if they don't already exist:

| Field | Type | Description |
|-------|------|-------------|
| `name` | Text | Customer name (max 200 chars) |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal notes |
| `bookings` | Join | Virtual field: all reservations for this customer |

The `bookings` field is a **join** field — it shows all reservations linked to this user without storing anything on the user document itself. Fields that already exist on the collection (e.g., if your Users collection already has a `name` field) are skipped to avoid duplicates.

**Example:**
```typescript
await payload.create({
  collection: 'users',
  data: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    password: 'securepassword',
    phone: '555-0101',
    notes: 'Prefers morning appointments',
  },
})
```

> **Note:** Since users is an auth collection, you must provide `email` and `password` when creating customers. The `email` field comes from Payload's built-in auth — the plugin does not add it.

### Reservations

**Slug:** `reservations`

The core booking records. Each reservation links a customer to a service performed by a resource at a specific time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Which service is being booked |
| `resource` | Relationship | Yes | Which resource performs the service |
| `customer` | Relationship | Yes | Who is booking (references the user collection) |
| `startTime` | Date | Yes | Appointment start (date + time picker) |
| `endTime` | Date | No | Auto-calculated, read-only (date + time picker) |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `cancellationReason` | Textarea | No | Shown only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |

**Status Options:** `pending`, `confirmed`, `completed`, `cancelled`, `no-show`

#### Status Definitions

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `pending` | Reservation created but not yet confirmed. Awaiting admin review, payment, or other verification. This is the default status for all new public reservations. | No |
| `confirmed` | Reservation is locked in. Payment received, admin approved, or created as a walk-in by staff. The time slot is committed. | No |
| `completed` | Appointment took place successfully. Set by admin after the service is delivered. | Yes |
| `cancelled` | Reservation was cancelled before the appointment (by customer or admin). Subject to the cancellation notice period. | Yes |
| `no-show` | Customer did not show up for a confirmed appointment. Set by admin after the scheduled time passes. | Yes |

Terminal statuses cannot transition to any other status. Once a reservation is `completed`, `cancelled`, or `no-show`, it is permanently closed.

**Example:**
```typescript
// Create a reservation (endTime is auto-calculated)
const reservation = await payload.create({
  collection: 'reservations',
  data: {
    service: haircutId,
    resource: aliceId,
    customer: janeUserId,
    startTime: '2025-06-15T10:00:00.000Z',
    status: 'pending',
  },
})

// endTime is automatically set to 10:30 (30 min haircut)
console.log(reservation.endTime) // '2025-06-15T10:30:00.000Z'
```

---

## Business Logic Hooks

Four `beforeChange` hooks are applied to the Reservations collection, executing in order:

### Auto End Time Calculation

**Hook:** `calculateEndTime`

Automatically computes `endTime` from `startTime + service.duration` on every create and update. The end time field is read-only in the admin UI.

```
endTime = startTime + service.duration (minutes)
```

**Why this matters:** Prevents manual calculation errors and ensures the calendar view and conflict detection always have accurate time ranges. Without auto-calculation, admins could accidentally enter wrong end times, causing invisible scheduling gaps or double-bookings that conflict detection wouldn't catch.

### Conflict Detection

**Hook:** `validateConflicts`

Prevents double-booking on the same resource. Checks for overlapping time ranges considering buffer times.

**How it works:**
1. Loads the service's `bufferTimeBefore` and `bufferTimeAfter` (falls back to `defaultBufferTime` from plugin config)
2. Computes the **blocked window**: `[startTime - bufferBefore, endTime + bufferAfter]`
3. Queries existing reservations for the same resource where status is not `cancelled` or `no-show`
4. On updates, excludes the current reservation from the conflict check
5. Throws a `ValidationError` if any overlap is found

**Example scenario:**
```
Service: Haircut (30 min, 5 min buffer before, 10 min buffer after)
Reservation: 10:00 - 10:30
Blocked window: 09:55 - 10:40

Another booking at 10:20 on the same resource -> CONFLICT ERROR
Another booking at 10:45 on the same resource -> OK
Another booking at 10:20 on a DIFFERENT resource -> OK
```

**Why this matters:** Protects against double-booking even when multiple users book simultaneously or when frontend data is stale. The server-side check is the single source of truth. Buffer times account for real-world setup and cleanup between appointments — a stylist needs time to clean their station, a room needs to be prepared, etc.

### Status Transition Enforcement

**Hook:** `validateStatusTransition`

Enforces a strict status state machine:

```
              +-> confirmed --+-> completed
              |               |
pending ------+               +-> cancelled
              |               |
              +-> cancelled   +-> no-show
```

**Rules:**
- **On create (public/unauthenticated):** Status must be `pending` (or not set, defaults to `pending`)
- **On create (authenticated admin):** Status can be `pending` or `confirmed` — this allows staff to create walk-in reservations that are already confirmed without a second step
- **On update:** Only valid transitions are allowed:
  - `pending` -> `confirmed`, `cancelled`
  - `confirmed` -> `completed`, `cancelled`, `no-show`
  - `completed`, `cancelled`, `no-show` -> *(terminal, no transitions allowed)*

Invalid transitions throw a `ValidationError`.

**Why this matters:** The state machine ensures data integrity by preventing nonsensical transitions (e.g., marking a cancelled reservation as completed). Terminal states (`completed`, `cancelled`, `no-show`) prevent accidental reopening of closed reservations. The admin quick-confirm feature supports walk-in workflows without bypassing the state machine — staff can create a reservation as `confirmed` in one step, but they still cannot skip directly to `completed`.

### Common Workflows

These workflows show how the status lifecycle and hooks work together in real-world scenarios.

**1. Online Booking (standard)**
```
Customer visits booking page → selects service, resource, time slot
  → payload.create({ status: 'pending' })          [hooks: endTime calculated, conflicts checked]
  → Admin reviews in admin panel
  → payload.update({ status: 'confirmed' })         [hooks: transition validated]
  → Appointment takes place
  → payload.update({ status: 'completed' })          [hooks: transition validated]
```

**2. Walk-In Booking**
```
Customer walks in, staff creates booking in admin panel
  → payload.create({ status: 'confirmed' })          [admin user, hooks: endTime + conflicts]
  → Appointment takes place
  → payload.update({ status: 'completed' })
```
Skips the `pending` step entirely — authenticated admin users can create directly as `confirmed`.

**3. Payment-Gated Booking**
```
Customer selects time slot on your frontend
  → payload.create({ status: 'pending' })            [slot is now held]
  → Your app creates a Stripe Checkout Session
  → Customer completes payment
  → Stripe webhook fires → payload.update({ status: 'confirmed' })
  → Appointment takes place → 'completed'
```
The `pending → confirmed` transition fits payment flows naturally. The slot is held from the moment of creation (conflict detection ran on create), so no one else can book the same time while payment processes. See [Integration Patterns](#integration-patterns) for a full code example.

**4. Customer Cancellation**
```
Customer requests cancellation (from 'pending' or 'confirmed')
  → payload.update({ status: 'cancelled', cancellationReason: '...' })
  → Hook checks: hours_until_appointment >= cancellationNoticePeriod
  → If enough notice: cancellation succeeds
  → If too late: ValidationError thrown, reservation unchanged
```

**5. No-Show Handling**
```
Appointment time passes, customer does not arrive
  → Admin marks: payload.update({ status: 'no-show' })      [only from 'confirmed']
  → Reservation is terminal — cannot be reopened
```
No-shows can only be marked on `confirmed` reservations. A `pending` reservation that nobody showed up for should be `cancelled` instead, since it was never confirmed.

### Cancellation Policy

**Hook:** `validateCancellation`

Enforces a minimum notice period for cancellations. When transitioning to `cancelled`, the hook checks that:

```
hours_until_appointment >= cancellationNoticePeriod
```

With the default `cancellationNoticePeriod: 24`, you cannot cancel a reservation that starts within the next 24 hours. The hook throws a `ValidationError` with details about how many hours remain.

**Why this matters:** Protects the business from last-minute cancellations that leave empty time slots that can't be filled by other customers. The configurable notice period lets each business set their own policy — a busy salon might require 48 hours, while a consultant might only need 2. Automated cleanup tasks can use the escape hatch to bypass this check when cancelling stale pending reservations.

### Escape Hatch

All four hooks check for `context.skipReservationHooks` and skip validation if it's truthy. This lets you bypass hooks for administrative operations, data migrations, or seeding:

```typescript
await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    status: 'completed', // Normally would fail (only pending/confirmed allowed on create)
  },
  context: {
    skipReservationHooks: true,
  },
})
```

> **Note:** Authenticated admin users can create reservations with `'confirmed'` status without the escape hatch. The escape hatch is only needed for statuses that are never allowed on create (e.g., `'completed'`, `'cancelled'`, `'no-show'`) or to bypass conflict detection and cancellation policy checks.

### Integration Patterns

#### Payment Integration (Stripe)

The `pending → confirmed` transition is a natural fit for payment-gated bookings. The reservation holds the time slot while payment processes, and the conflict detection hook has already validated availability on create.

**Flow:**
1. Customer creates a reservation → status is `pending`, slot is held
2. Your app creates a Stripe Checkout Session with the reservation ID in metadata
3. Customer completes payment on Stripe's hosted page
4. Stripe sends a `checkout.session.completed` webhook to your app
5. Your webhook handler updates the reservation to `confirmed`
6. If payment fails or expires, the reservation stays `pending` for cleanup

**Webhook handler example:**

```ts
// app/api/stripe-webhook/route.ts
import { getPayload } from 'payload'
import config from '@payload-config'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  const event = stripe.webhooks.constructEvent(
    body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const reservationId = session.metadata?.reservationId

    if (reservationId) {
      const payload = await getPayload({ config })
      await payload.update({
        collection: 'reservations',
        id: reservationId,
        data: { status: 'confirmed' },
      })
    }
  }

  return new Response('OK', { status: 200 })
}
```

> **Slot protection:** The `validateConflicts` hook runs on create, so the time slot is already reserved while the customer pays. No other booking can claim the same slot, even if the payment takes several minutes.

#### Notification Integration

Use Payload's `afterChange` hook on the Reservations collection (in your app config, outside the plugin) to trigger notifications when status changes. The plugin does not send notifications itself, giving you full control over messaging.

**Example scenarios:**
- **Confirmed** — send a confirmation email with appointment details
- **Upcoming reminder** — trigger a reminder 24 hours before the appointment (via a scheduled task)
- **Cancelled** — notify the customer and optionally alert staff about the freed slot
- **No-show** — notify staff for internal tracking

```ts
// In your payload.config.ts, add an afterChange hook to the reservations collection
// using Payload's collections override or a separate plugin

const notifyOnStatusChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
}) => {
  if (operation === 'update' && doc.status !== previousDoc.status) {
    switch (doc.status) {
      case 'confirmed':
        await sendConfirmationEmail(doc)
        break
      case 'cancelled':
        await sendCancellationEmail(doc)
        break
    }
  }
}
```

#### Scheduled Cleanup

Reservations that stay `pending` indefinitely (e.g., abandoned payment flows) hold time slots that could be used by other customers. Set up a scheduled task to cancel stale pending reservations:

- Query for `pending` reservations older than your threshold (e.g., 30 minutes)
- Update them to `cancelled` using the escape hatch to bypass the cancellation notice period
- Optionally notify the customer that their hold expired

```ts
// Example: cron job or scheduled task
const payload = await getPayload({ config })

const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

const { docs: staleReservations } = await payload.find({
  collection: 'reservations',
  where: {
    status: { equals: 'pending' },
    createdAt: { less_than: thirtyMinutesAgo.toISOString() },
  },
})

for (const reservation of staleReservations) {
  await payload.update({
    collection: 'reservations',
    id: reservation.id,
    data: {
      status: 'cancelled',
      cancellationReason: 'Automatically cancelled — payment not completed',
    },
    context: { skipReservationHooks: true }, // bypass cancellation notice period
  })
}
```

---

## Admin UI Components

### Dashboard Widget

**Type:** React Server Component (RSC)
**Location:** Modular Dashboard Widget (`admin.dashboard.widgets`)
**Widget slug:** `reservation-todays-reservations`
**Default size:** medium–large

Uses Payload's modular dashboard widget system (v3.69.0+), which supports configurable sizing, drag-and-drop layout, and add/remove functionality. Displays a summary of today's reservations:

- **Total** reservations today
- **Upcoming** reservations (not yet completed/cancelled, start time in future)
- **Completed** reservations
- **Cancelled** reservations
- **Next Appointment** details (time and status)

The widget queries the database directly via the Payload Local API (server-side, no HTTP requests).

### Calendar View

**Type:** Client Component
**Location:** Replaces the Reservations list view

A CSS Grid-based calendar (no external dependencies) with three view modes:

- **Month View** - 6-week grid showing all days with reservation chips
- **Week View** - 7-day grid with hourly rows (7am-6pm)
- **Day View** - Single day with hourly rows (7am-8pm)

**Features:**
- Navigation (previous/next, "Today" button)
- Color-coded by status:
  - Pending: Yellow
  - Confirmed: Blue
  - Completed: Green
  - Cancelled: Gray
  - No-show: Red
- **Status legend** displayed below the header explaining what each color means
- **Click-to-create:** Click any calendar cell to open a new reservation drawer with the start time pre-filled
  - Month view: clicking a day cell pre-fills start time at 9:00 AM on that date
  - Week/day views: clicking a time cell pre-fills the exact hour for that slot
- Click any existing reservation to open a Payload document drawer for editing
- **Enhanced event display:**
  - Month view (compact): shows time + service name
  - Week/day views (full): shows time + service name + customer name
- **Tooltips:** Hover any reservation event to see full details (service, time range, customer, resource, status) via native browser tooltip
- **Current time indicator:** A red horizontal line in week/day views showing the current time position within the matching hour cell
- Fetches data via REST API for the visible date range

### Availability Overview

**Type:** Client Component
**Location:** Custom admin view at `/admin/reservation-availability`

A weekly grid showing resource availability:

- **Rows** = Active resources
- **Columns** = Days of the week
- **Green slots** = Available time ranges (from schedules)
- **Blue slots** = Booked times (from reservations)
- **Gray slots** = Exception dates (unavailable)

Navigate between weeks with previous/next buttons or jump to "This Week".

---

## Utilities

### slotUtils.ts

Time math helpers used by hooks:

| Function | Description |
|----------|-------------|
| `addMinutes(date, minutes)` | Add minutes to a date, returns new Date |
| `doRangesOverlap(startA, endA, startB, endB)` | Check if two time ranges overlap (half-open intervals) |
| `computeBlockedWindow(start, end, bufferBefore, bufferAfter)` | Compute effective blocked window with buffers |
| `hoursUntil(futureDate, now?)` | Calculate hours between now and a future date |

### scheduleUtils.ts

Schedule resolution helpers used by admin components:

| Function | Description |
|----------|-------------|
| `getDayOfWeek(date)` | Get the DayOfWeek value for a Date |
| `dateMatchesDay(date, day)` | Check if a date matches a DayOfWeek |
| `parseTime(time)` | Parse "HH:mm" string to hours/minutes |
| `combineDateAndTime(date, time)` | Merge a date with a "HH:mm" time string |
| `isExceptionDate(date, exceptions)` | Check if a date is an exception |
| `resolveScheduleForDate(schedule, date)` | Resolve concrete time ranges for a date |

---

## Frontend Reservation Guide

The plugin is backend-only — it adds collections, hooks, and admin UI to Payload but does not include any customer-facing pages. However, you can build a full booking flow using Payload's built-in Local API (from Server Components / Server Actions) or REST API. No custom endpoints are needed.

### Step 1: Configure Access Control

By default all collections use Payload's default access control (authenticated users only). To allow public booking, pass `access` overrides in your plugin config:

```ts
import { reservationPlugin } from 'payload-reserve'

reservationPlugin({
  access: {
    services: {
      read: () => true,       // anyone can browse services
    },
    resources: {
      read: () => true,       // anyone can browse resources
    },
    schedules: {
      read: () => true,       // anyone can check availability
    },
    reservations: {
      create: () => true,     // guests can book
      read: ({ req }) => {
        // customers can only read their own reservations
        if (req.user) return true
        return false
      },
    },
  },
})
```

> **Note:** Access control for the Users collection itself is defined on your Users collection config, not via the plugin's `access` option. The plugin only extends the Users collection with fields — it doesn't control its access.

> **Important:** Always use `overrideAccess: false` in your frontend queries so these rules are enforced. Without it, Payload bypasses access control entirely.

### Step 2: Fetch Available Services

Use a React Server Component to list active services:

```tsx
// app/book/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function BookingPage() {
  const payload = await getPayload({ config })

  const { docs: services } = await payload.find({
    collection: 'reservation-services',
    overrideAccess: false,
    where: { active: { equals: true } },
  })

  return (
    <ul>
      {services.map((service) => (
        <li key={service.id}>
          {service.name} — {service.duration} min — ${service.price}
        </li>
      ))}
    </ul>
  )
}
```

### Step 3: Fetch Resources for a Service

Once a customer picks a service, load the resources that offer it:

```ts
const { docs: resources } = await payload.find({
  collection: 'reservation-resources',
  overrideAccess: false,
  where: {
    services: { contains: selectedServiceId },
    active: { equals: true },
  },
})
```

### Step 4: Check Availability

Fetch the resource's schedule and existing reservations for the target date, then compute open slots:

```ts
import {
  resolveScheduleForDate,
  addMinutes,
  doRangesOverlap,
  computeBlockedWindow,
} from 'payload-reserve'

// 1. Get the resource's active schedule
const { docs: schedules } = await payload.find({
  collection: 'reservation-schedules',
  overrideAccess: false,
  where: {
    resource: { equals: resourceId },
    active: { equals: true },
  },
})

// 2. Resolve available time ranges for the target date
const targetDate = new Date('2025-03-15')
const availableRanges = schedules.flatMap((schedule) =>
  resolveScheduleForDate(schedule, targetDate),
)

// 3. Fetch existing reservations for that resource on that date
const dayStart = new Date(targetDate)
dayStart.setHours(0, 0, 0, 0)
const dayEnd = new Date(targetDate)
dayEnd.setHours(23, 59, 59, 999)

const { docs: existingReservations } = await payload.find({
  collection: 'reservations',
  overrideAccess: false,
  where: {
    resource: { equals: resourceId },
    startTime: { greater_than_equal: dayStart.toISOString() },
    startTime: { less_than: dayEnd.toISOString() },
    status: { not_equals: 'cancelled' },
  },
})

// 4. Generate slots by stepping through available ranges
//    and filtering out conflicts with existing reservations
const slots = []
for (const range of availableRanges) {
  let cursor = range.start
  while (addMinutes(cursor, serviceDuration) <= range.end) {
    const slotEnd = addMinutes(cursor, serviceDuration)
    const blocked = existingReservations.some((res) => {
      const window = computeBlockedWindow(
        new Date(res.startTime),
        new Date(res.endTime),
        service.bufferTimeBefore ?? 0,
        service.bufferTimeAfter ?? 0,
      )
      return doRangesOverlap(cursor, slotEnd, window.start, window.end)
    })
    if (!blocked) slots.push(cursor)
    cursor = addMinutes(cursor, 15) // 15-minute step
  }
}
```

### Step 5: Create the Reservation

Use a Server Action to create the reservation. The plugin's `beforeChange` hooks automatically calculate the end time, validate conflicts, and enforce status transitions:

```ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'

export async function createReservation(data: {
  service: string
  resource: string
  customerName: string
  customerEmail: string
  startTime: string
  notes?: string
}) {
  const payload = await getPayload({ config })

  // Find or create the customer (customers are users)
  const existing = await payload.find({
    collection: 'users',
    overrideAccess: false,
    where: { email: { equals: data.customerEmail } },
  })

  let customerId: string
  if (existing.docs.length > 0) {
    customerId = String(existing.docs[0].id)
  } else {
    const customer = await payload.create({
      collection: 'users',
      overrideAccess: false,
      data: {
        name: data.customerName,
        email: data.customerEmail,
        password: generateSecurePassword(), // auth collection requires a password
      },
    })
    customerId = String(customer.id)
  }

  // Create the reservation — hooks handle endTime calculation and conflict checks
  const reservation = await payload.create({
    collection: 'reservations',
    overrideAccess: false,
    data: {
      service: data.service,
      resource: data.resource,
      customer: customerId,
      startTime: data.startTime,
      notes: data.notes,
      // status defaults to 'pending'
    },
  })

  return reservation
}
```

If the time slot is already booked, the `validateConflicts` hook will throw a `ValidationError` — catch it in your UI and prompt the user to pick a different slot.

### Security Notes

- **Always pass `overrideAccess: false`** — without it, Payload skips access control and any user can read/write anything.
- Validate and sanitize all user input before passing it to `payload.create`.
- Consider adding rate limiting to your Server Actions or API routes to prevent abuse.
- The plugin's hooks enforce conflict detection server-side, so double-bookings are prevented even if the frontend has stale data.

### Alternative: REST API

If you prefer a client-side-only approach (e.g., a separate SPA), use Payload's auto-generated REST API:

```ts
// Fetch services
const res = await fetch('https://your-site.com/api/reservation-services?where[active][equals]=true')
const { docs: services } = await res.json()

// Create a reservation (customer is a user ID)
const res = await fetch('https://your-site.com/api/reservations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service: serviceId,
    resource: resourceId,
    customer: userId,
    startTime: '2025-03-15T10:00:00.000Z',
  }),
})
```

The same hooks and access control rules apply to REST API requests.

---

## Development

### Prerequisites

- Node.js ^18.20.2 or >=20.9.0
- pnpm ^9 or ^10
- MongoDB (or the in-memory server used for testing)

### Commands

```bash
# Start dev server (Next.js + Payload admin panel)
pnpm dev

# Generate Payload types after schema changes
pnpm dev:generate-types

# Generate import map after adding/removing components
pnpm dev:generate-importmap

# Run integration tests (Vitest)
pnpm test:int

# Run end-to-end tests (Playwright)
pnpm test:e2e

# Run all tests
pnpm test

# Lint source code
pnpm lint

# Auto-fix lint issues
pnpm lint:fix

# Build for production
pnpm build

# Clean build artifacts
pnpm clean
```

### Dev Environment

The `dev/` directory contains a complete Payload CMS app for testing:

- **`dev/payload.config.ts`** - Payload config with the plugin installed
- **`dev/seed.ts`** - Seeds sample data: 3 services, 2 resources, 2 schedules, 2 customer users, 3 reservations
- **`dev/int.spec.ts`** - Integration tests covering all hooks and CRUD operations

The dev environment uses `mongodb-memory-server` for testing, so no external MongoDB instance is required.

### Seed Data

When you run `pnpm dev`, the seed script creates:

**Services:**
- Haircut (30 min, $35, 5 min buffer before, 10 min after)
- Hair Coloring (90 min, $120, 10 min buffer before, 15 min after)
- Consultation (15 min, free, 0 min buffer before, 5 min after)

**Resources:**
- Alice Johnson (Senior Stylist) - performs all 3 services
- Bob Smith (Junior Stylist) - performs Haircut and Consultation

**Schedules:**
- Alice: Mon-Thu 9am-5pm, Fri 9am-3pm
- Bob: Mon/Wed/Fri 10am-6pm, Sat 9am-2pm

**Customers (created as users):**
- Jane Doe (jane@example.com)
- John Public (john@example.com)

**Reservations (today):**
- 9:00 AM - Haircut with Alice (confirmed)
- 10:00 AM - Consultation with Bob (pending)
- 2:00 PM - Hair Coloring with Alice (pending)

---

## Project Structure

```
src/
  index.ts                              # Public API: re-exports plugin + types
  plugin.ts                             # Main plugin factory function
  types.ts                              # All TypeScript types + status transitions
  defaults.ts                           # Default config values + resolver

  collections/
    Services.ts                         # Service definitions
    Resources.ts                        # Providers/resources
    Schedules.ts                        # Availability schedules
    Reservations.ts                     # Bookings with hooks

  hooks/
    reservations/
      calculateEndTime.ts              # Auto-compute endTime
      validateConflicts.ts             # Double-booking prevention
      validateStatusTransition.ts      # Status state machine
      validateCancellation.ts          # Cancellation notice period
    index.ts                            # Barrel export

  utilities/
    slotUtils.ts                        # Time math helpers
    scheduleUtils.ts                    # Schedule resolution helpers

  components/
    CalendarView/
      index.tsx                         # Client: calendar for reservations
      CalendarView.module.css
    DashboardWidget/
      DashboardWidgetServer.tsx         # RSC: today's booking stats
      DashboardWidget.module.css
    AvailabilityOverview/
      index.tsx                         # Client: weekly availability grid
      AvailabilityOverview.module.css

  exports/
    client.ts                           # CalendarView, AvailabilityOverview
    rsc.ts                              # DashboardWidgetServer
```

---

## API Reference

### Plugin Export

```typescript
import { reservationPlugin } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'
```

### Client Exports

```typescript
import { CalendarView, AvailabilityOverview } from 'reservation-plugin/client'
```

### RSC Exports

```typescript
import { DashboardWidgetServer } from 'reservation-plugin/rsc'
```

### Type Exports

```typescript
import type {
  ReservationPluginConfig,
  ResolvedReservationPluginConfig,
} from 'reservation-plugin'
```

### Integration Test Coverage

The plugin ships with 16 integration tests covering:

| Test | What It Verifies |
|------|-----------------|
| Collections registered | All 4 plugin collections exist after plugin init |
| User collection extended | Users collection has phone, notes, bookings fields |
| Create service | Service CRUD with all fields |
| Create resource | Resource with service relationship |
| Create schedule | Recurring schedule with slots |
| Create user with customer fields | User with name, phone, email |
| Auto endTime | endTime = startTime + duration |
| Conflict: same resource | Double-booking is rejected |
| Conflict: different resource | Same time on different resource is allowed |
| Status: must start pending | Creating with non-pending status fails (public context) |
| Status: valid transition | pending -> confirmed succeeds |
| Status: admin create confirmed | Admin user can create reservation as confirmed |
| Status: admin create completed | Admin user cannot create reservation as completed |
| Status: invalid transition | completed -> pending fails |
| Cancel: too late | Cancellation within notice period fails |
| Cancel: sufficient notice | Cancellation with enough notice succeeds |

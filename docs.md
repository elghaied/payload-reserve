# Reservation Plugin for Payload CMS 3.x

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
  - [Customers](#customers)
  - [Reservations](#reservations)
- [Business Logic Hooks](#business-logic-hooks)
  - [Auto End Time Calculation](#auto-end-time-calculation)
  - [Conflict Detection](#conflict-detection)
  - [Status Transition Enforcement](#status-transition-enforcement)
  - [Cancellation Policy](#cancellation-policy)
  - [Escape Hatch](#escape-hatch)
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

- **5 Standalone Collections** - Services, Resources, Schedules, Customers, and Reservations
- **Double-Booking Prevention** - Automatic conflict detection with configurable buffer times
- **Status State Machine** - Enforced workflow: pending -> confirmed -> completed/cancelled/no-show
- **Auto End Time** - Automatically calculates reservation end time from service duration
- **Cancellation Policy** - Configurable notice period enforcement
- **Calendar View** - Month/week/day calendar replacing the default reservations list view
- **Dashboard Widget** - Server component showing today's booking stats at a glance
- **Availability Grid** - Weekly overview of resource availability vs. booked slots
- **Recurring & Manual Schedules** - Flexible schedule types with exception dates
- **Fully Configurable** - Override slugs, access control, buffer times, and admin grouping
- **Type-Safe** - Full TypeScript support with exported types

---

## Installation

```bash
# Install the plugin as a dependency
pnpm add reservation-plugin

# Or if developing locally, link it
pnpm link ./plugins/reservation-plugin
```

**Peer Dependency:** Requires `payload ^3.37.0`.

---

## Quick Start

Add the plugin to your `payload.config.ts`:

```typescript
import { buildConfig } from 'payload'
import { reservationPlugin } from 'reservation-plugin'

export default buildConfig({
  // ... your existing config
  plugins: [
    reservationPlugin(),
  ],
})
```

That's it. The plugin registers 5 collections, a dashboard widget, a calendar list view, and an availability admin view automatically. All collections appear under the **"Reservations"** group in the admin panel.

---

## Configuration

All options are optional. The plugin works out of the box with sensible defaults.

```typescript
import { reservationPlugin } from 'reservation-plugin'
import type { ReservationPluginConfig } from 'reservation-plugin'

const config: ReservationPluginConfig = {
  // Disable the plugin entirely (collections are still registered for schema consistency)
  disabled: false,

  // Override collection slugs
  slugs: {
    services: 'reservation-services',       // default
    resources: 'reservation-resources',      // default
    schedules: 'reservation-schedules',      // default
    reservations: 'reservations',            // default
    customers: 'reservation-customers',      // default
  },

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
    customers: { /* ... */ },
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
| `slugs.customers` | `'reservation-customers'` | Customers collection slug |
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

### Customers

**Slug:** `reservation-customers`

Customer records with contact info and a virtual reverse relationship to their bookings.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Customer name (max 200 chars, used as title) |
| `email` | Email | Yes | Customer email (unique) |
| `phone` | Text | No | Phone number (max 50 chars) |
| `notes` | Textarea | No | Internal notes |
| `bookings` | Join | - | Virtual field: all reservations for this customer |

The `bookings` field is a **join** field - it shows all reservations linked to this customer without storing anything on the customer document itself.

**Example:**
```typescript
await payload.create({
  collection: 'reservation-customers',
  data: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0101',
    notes: 'Prefers morning appointments',
  },
})
```

### Reservations

**Slug:** `reservations`

The core booking records. Each reservation links a customer to a service performed by a resource at a specific time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Which service is being booked |
| `resource` | Relationship | Yes | Which resource performs the service |
| `customer` | Relationship | Yes | Who is booking |
| `startTime` | Date | Yes | Appointment start (date + time picker) |
| `endTime` | Date | No | Auto-calculated, read-only (date + time picker) |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `cancellationReason` | Textarea | No | Shown only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |

**Status Options:** `pending`, `confirmed`, `completed`, `cancelled`, `no-show`

**Example:**
```typescript
// Create a reservation (endTime is auto-calculated)
const reservation = await payload.create({
  collection: 'reservations',
  data: {
    service: haircutId,
    resource: aliceId,
    customer: janeId,
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
- **On create:** Status must be `pending` (or not set, defaults to `pending`)
- **On update:** Only valid transitions are allowed:
  - `pending` -> `confirmed`, `cancelled`
  - `confirmed` -> `completed`, `cancelled`, `no-show`
  - `completed`, `cancelled`, `no-show` -> *(terminal, no transitions allowed)*

Invalid transitions throw a `ValidationError`.

### Cancellation Policy

**Hook:** `validateCancellation`

Enforces a minimum notice period for cancellations. When transitioning to `cancelled`, the hook checks that:

```
hours_until_appointment >= cancellationNoticePeriod
```

With the default `cancellationNoticePeriod: 24`, you cannot cancel a reservation that starts within the next 24 hours. The hook throws a `ValidationError` with details about how many hours remain.

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
    status: 'confirmed', // Normally would fail (must start as pending)
  },
  context: {
    skipReservationHooks: true,
  },
})
```

---

## Admin UI Components

### Dashboard Widget

**Type:** React Server Component (RSC)
**Location:** Before Dashboard

Displays a summary of today's reservations:

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
- Click any reservation to open a Payload document drawer for editing
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
- **`dev/seed.ts`** - Seeds sample data: 3 services, 2 resources, 2 schedules, 2 customers, 3 reservations
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

**Customers:**
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
    Customers.ts                        # Customer records
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
import { reservationPlugin } from 'reservation-plugin'
import type { ReservationPluginConfig } from 'reservation-plugin'
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

The plugin ships with 11 integration tests covering:

| Test | What It Verifies |
|------|-----------------|
| Collections registered | All 5 collections exist after plugin init |
| Create service | Service CRUD with all fields |
| Create resource | Resource with service relationship |
| Create schedule | Recurring schedule with slots |
| Create customer | Customer with unique email |
| Auto endTime | endTime = startTime + duration |
| Conflict: same resource | Double-booking is rejected |
| Conflict: different resource | Same time on different resource is allowed |
| Status: must start pending | Creating with non-pending status fails |
| Status: valid transition | pending -> confirmed succeeds |
| Status: invalid transition | completed -> pending fails |
| Cancel: too late | Cancellation within notice period fails |
| Cancel: sufficient notice | Cancellation with enough notice succeeds |

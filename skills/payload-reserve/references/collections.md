# Collection Schemas

## Table of Contents

- [Services](#services)
- [Resources](#resources)
- [Schedules](#schedules)
- [Reservations](#reservations)
- [User Collection Extension (Customers)](#user-collection-extension-customers)

---

## Services

**Default slug:** `services`

Defines what can be booked (e.g., "Haircut", "Consultation", "Massage").

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | Text | Yes | — | Service name (max 200 chars, used as title) |
| `description` | Textarea | No | — | Service description |
| `duration` | Number | Yes | — | Duration in minutes (min: 1) |
| `price` | Number | No | — | Price (min: 0, step: 0.01) |
| `bufferTimeBefore` | Number | No | 0 | Buffer minutes before appointment |
| `bufferTimeAfter` | Number | No | 0 | Buffer minutes after appointment |
| `active` | Checkbox | No | true | Whether service is active (sidebar field) |

```ts
await payload.create({
  collection: 'services',
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

---

## Resources

**Default slug:** `resources`

Who or what performs the service (e.g., a stylist, a room, a consultant).

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | Text | Yes | — | Resource name (max 200 chars, used as title) |
| `image` | Upload | No | — | Resource image (references media collection, configurable via `slugs.media`) |
| `description` | Textarea | No | — | Resource description |
| `services` | Relationship | Yes | — | Services this resource can perform (hasMany, references Services) |
| `active` | Checkbox | No | true | Whether resource is active (sidebar field) |

```ts
await payload.create({
  collection: 'resources',
  data: {
    name: 'Alice Johnson',
    description: 'Senior Stylist',
    services: [haircutId, coloringId],
    active: true,
  },
})
```

---

## Schedules

**Default slug:** `schedules`

Defines when a resource is available. Supports **recurring** (weekly pattern) and **manual** (specific dates) modes, plus exception dates.

| Field | Type | Required | Condition | Description |
|-------|------|----------|-----------|-------------|
| `name` | Text | Yes | — | Schedule name (used as title) |
| `resource` | Relationship | Yes | — | Which resource this schedule belongs to |
| `scheduleType` | Select | No | — | `'recurring'` or `'manual'` (default: `'recurring'`) |
| `recurringSlots` | Array | No | type=recurring | Weekly slots |
| `recurringSlots.day` | Select | Yes | — | Day of week (`mon`-`sun`) |
| `recurringSlots.startTime` | Text | Yes | — | Start time (`HH:mm` format) |
| `recurringSlots.endTime` | Text | Yes | — | End time (`HH:mm` format) |
| `manualSlots` | Array | No | type=manual | Specific date slots |
| `manualSlots.date` | Date | Yes | — | Specific date (day only) |
| `manualSlots.startTime` | Text | Yes | — | Start time (`HH:mm` format) |
| `manualSlots.endTime` | Text | Yes | — | End time (`HH:mm` format) |
| `exceptions` | Array | No | — | Dates when the resource is unavailable |
| `exceptions.date` | Date | Yes | — | Exception date (day only) |
| `exceptions.reason` | Text | No | — | Reason for unavailability |
| `active` | Checkbox | No | — | Whether schedule is active (default: true, sidebar field) |

```ts
// Recurring schedule
await payload.create({
  collection: 'schedules',
  data: {
    name: 'Alice - Weekdays',
    resource: aliceId,
    scheduleType: 'recurring',
    recurringSlots: [
      { day: 'mon', startTime: '09:00', endTime: '17:00' },
      { day: 'tue', startTime: '09:00', endTime: '17:00' },
      { day: 'fri', startTime: '09:00', endTime: '15:00' },
    ],
    exceptions: [
      { date: '2025-12-25', reason: 'Christmas' },
    ],
    active: true,
  },
})
```

---

## Reservations

**Default slug:** `reservations`

The core booking records. Each reservation links a customer to a service performed by a resource at a specific time.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Which service is being booked (references Services) |
| `resource` | Relationship | Yes | Which resource performs the service (references Resources) |
| `customer` | Relationship | Yes | Who is booking (references the user collection) |
| `startTime` | Date | Yes | Appointment start (date + time picker) |
| `endTime` | Date | No | Auto-calculated by hook, read-only |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `cancellationReason` | Textarea | No | Shown only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |

**Status options:** `pending`, `confirmed`, `completed`, `cancelled`, `no-show`

```ts
// endTime is auto-calculated from startTime + service.duration
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
// reservation.endTime === '2025-06-15T10:30:00.000Z' (30 min haircut)
```

---

## User Collection Extension (Customers)

Instead of a standalone Customers collection, the plugin extends the existing auth-enabled Users collection (configurable via `userCollection` option, default: `'users'`).

Fields appended (skipped if already present):

| Field | Type | Description |
|-------|------|-------------|
| `name` | Text | Customer name (max 200 chars) |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal notes |
| `bookings` | Join | Virtual field: all reservations for this customer (join on `customer`) |

The `bookings` field is a **join** — it shows all reservations linked to this user without storing anything on the user document.

Since users is an auth collection, `email` and `password` are required when creating customers. The `email` field comes from Payload's built-in auth — the plugin does not add it.

```ts
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

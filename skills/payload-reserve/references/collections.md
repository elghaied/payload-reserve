# Collection Schemas

## Services

**Slug:** `services` (configurable via `slugs.services`)

Defines what can be booked (treatments, room types, service offerings).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Service name (max 200 chars) |
| `image` | Upload | No | Service image |
| `description` | Textarea | No | Service description |
| `duration` | Number | Yes | Duration in minutes (min: 1) |
| `durationType` | Select | Yes | `'fixed'`, `'flexible'`, or `'full-day'` (default: `'fixed'`) |
| `price` | Number | No | Price (min: 0, step: 0.01) |
| `bufferTimeBefore` | Number | No | Buffer minutes before slot (default: 0) |
| `bufferTimeAfter` | Number | No | Buffer minutes after slot (default: 0) |
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

---

## Resources

**Slug:** `resources` (configurable via `slugs.resources`)

Who or what performs the service (a stylist, a room, a machine).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Resource name (max 200 chars) |
| `image` | Upload | No | Resource photo |
| `description` | Textarea | No | Resource description |
| `services` | Relationship | Yes | Services this resource can perform (hasMany) |
| `active` | Checkbox | No | Whether resource accepts bookings (default: true) |
| `quantity` | Number | Yes | Concurrent bookings allowed (default: 1) |
| `capacityMode` | Select | No | `'per-reservation'` or `'per-guest'` — shown only when `quantity > 1` |
| `timezone` | Text | No | IANA timezone for display |

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

---

## Schedules

**Slug:** `schedules` (configurable via `slugs.schedules`)

Defines when a resource is available. Supports **recurring** (weekly pattern) and **manual** (specific dates), plus exception dates.

| Field | Type | Description |
|-------|------|-------------|
| `name` | Text | Schedule name |
| `resource` | Relationship | Which resource this belongs to |
| `scheduleType` | Select | `'recurring'` or `'manual'` (default: `'recurring'`) |
| `recurringSlots` | Array | Weekly slots: `day`, `startTime`, `endTime` |
| `manualSlots` | Array | Specific date slots: `date`, `startTime`, `endTime` |
| `exceptions` | Array | Blocked dates: `date`, `reason` |
| `active` | Checkbox | Whether this schedule is in effect (default: true) |

Times use `HH:mm` 24-hour format. Exception dates block the entire day.

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

---

## Customers

**Slug:** `customers` (or your `userCollection` slug)

### Standalone Mode (default — no `userCollection` set)

A dedicated auth collection with `auth: true` and `access.admin: () => false`. Customers can log in but cannot access the admin panel.

### User Collection Mode (`userCollection` set)

No new collection is created. The plugin injects `phone`, `notes`, and a `bookings` join field into your existing auth collection (deduplication prevents double-injection).

| Field | Type | Description |
|-------|------|-------------|
| `email` | Email | Customer email (from Payload auth) |
| `firstName` | Text | First name (standalone mode only) |
| `lastName` | Text | Last name (standalone mode only) |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal admin notes |
| `bookings` | Join | Virtual — all reservations for this customer |

---

## Reservations

**Slug:** `reservations` (configurable via `slugs.reservations`)

The core booking records.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Service being booked |
| `resource` | Relationship | Yes | Resource performing the service |
| `customer` | Relationship | Yes | Customer making the booking |
| `startTime` | Date | Yes | Appointment start |
| `endTime` | Date | No | Auto-calculated (do not set manually for fixed services) |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `guestCount` | Number | No | Number of guests (default: 1) |
| `cancellationReason` | Textarea | No | Visible only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |
| `items` | Array | No | Additional resources in a multi-resource booking |
| `idempotencyKey` | Text | No | Unique key to prevent duplicate submissions |

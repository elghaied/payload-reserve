# Collections

Schemas for all five collections created by the plugin.

## Services

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

See [Booking Features → Duration Types](./booking-features.md#duration-types) for how `durationType` affects end time calculation.

---

## Resources

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

See [Booking Features → Capacity and Inventory](./booking-features.md#capacity-and-inventory) for how `quantity` and `capacityMode` work together.

---

## Schedules

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

---

## Customers

**Slug:** `customers` (or your `userCollection` slug)

Either a standalone auth collection (default) or fields injected into your existing auth collection when `userCollection` is set.

### Standalone Mode (default)

A dedicated auth collection with `auth: true` for customer JWT login. Has `access.admin: () => false` to block customers from the admin panel.

### User Collection Mode (`userCollection` set)

The plugin injects `phone`, `notes`, and a `bookings` join field into your existing auth collection. No new collection is created. The resolved `slugs.customers` points at the user collection so all downstream code uses the correct slug.

Field deduplication prevents double-injection — the plugin checks `'name' in field` before injecting.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `email` | Email | Customer email (from Payload auth) |
| `firstName` | Text | First name (standalone mode only) |
| `lastName` | Text | Last name (standalone mode only) |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal notes visible only to admins |
| `bookings` | Join | Virtual field — all reservations for this customer |

---

## Reservations

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

See [Booking Features → Multi-Resource Bookings](./booking-features.md#multi-resource-bookings) for details on the `items` array.

---

← [Configuration](./configuration.md) | → [Status Machine](./status-machine.md) | ↑ [Back to README](../README.md)

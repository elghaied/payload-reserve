# Booking Features

Covers duration types, multi-resource bookings, capacity/inventory management, exceptions/time off, and how updates are re-validated.

## Duration Types

Set on each service via the `durationType` field. Controls how `endTime` is calculated.

### Fixed (default)

`endTime = startTime + service.duration`

The standard appointment mode. The service duration is fixed and always applied. Used for haircuts, consultations, classes with defined runtimes.

```typescript
{ duration: 60, durationType: 'fixed' }
// A 60-minute appointment — endTime is always startTime + 60 min
```

### Flexible

`endTime` is provided by the caller in the booking request. The service `duration` field is the minimum — a window shorter than `duration` minutes is rejected (`endTime must be at least N minutes after startTime`; documented since the field shipped, enforced since 4.1.2) — and the plugin option `maxFlexibleDuration` (default 1440 minutes) is the maximum (`Flexible bookings cannot exceed N minutes`). An inverted window — `endTime` at or before `startTime` — is rejected on both create and update. The same bounds apply to a `flexible` hold taken through `/api/reserve/hold`. Before the ceiling existed, one request could occupy a resource until 2099. In the admin UI the reservation `endTime` field is editable (not read-only) precisely so flexible bookings can set it; for `fixed`/`full-day` services it is auto-computed and overwritten on save.

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

**Inheritance rules:** Items missing `startTime`, `endTime`, `service`, or `guestCount` inherit the parent reservation's values.

**Validation:**
- Every item must have a `resource` and `startTime` (either its own or inherited from the parent). Items missing required fields throw a `ValidationError` identifying which item is incomplete (e.g., `items.1.resource`).
- Duplicate `(resource, startTime)` pairs within the same booking are rejected.
- Conflict errors include the item index (e.g., `items.2.startTime`) so you know which item failed.

**Conflict detection** runs independently for each resource in the `items` array. Each resource is blocked only for **its own item's** time window — not the whole span of the booking. A `[room 9:00–10:00, sauna 14:00–15:00]` package leaves the room free between 10:00 and 15:00, since the room item only occupies 9:00–10:00.

Each item's own service determines its buffer times (`bufferTimeBefore`/`bufferTimeAfter`), so different items can have different buffer windows. Buffers are enforced **symmetrically** between neighbors: the gap required between two bookings on the same resource is the later booking's `bufferTimeBefore` plus the earlier booking's `bufferTimeAfter` (previously only the candidate booking's own buffers applied). Service buffer fields are capped at 1439 minutes.

Two items in the **same** booking that target the same resource are also checked against each other, so a single create can't double-book one resource across two of its own items.

### Auto-expanded required resources

A service can declare `requiredResources` (a `hasMany` relationship to additional resource pools it always needs — e.g. a treatment that also consumes a shared room or a salon haircut that occupies a chair). On create, the `expandRequiredResources` hook automatically appends those resources to the reservation's `items[]` before conflict detection and `endTime` calculation run, so the caller doesn't have to list them manually.

```typescript
// Service with a required shared room pool
{ name: 'Deep Tissue Massage', requiredResources: [roomPoolId] }

// Booking only needs the therapist; the room pool is auto-added to items[]
await payload.create({
  collection: 'reservations',
  data: { service: massageId, resource: therapistId, customer, startTime },
})
```

Conflict detection then verifies every expanded item — including required pools — is free for the window. If any required pool is fully booked at that time, the create fails with a conflict error that identifies the offending item (e.g. `items.1.startTime`).

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

**`per-guest`:** Each booking occupies `guestCount` units. Capacity is counted by summing the `guestCount` of every matched item that lands on the resource for the overlapping window. Use this for group venues, yoga classes, boat tours, or any resource with a total people capacity.

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

### Guest counts

`guestCount` on a reservation (or per item) records how many people the booking is for. It only affects capacity math when the resource uses `capacityMode: 'per-guest'` (above); in `per-reservation` mode it is informational. Items inherit the parent `guestCount` when omitted, defaulting to `1`. The availability endpoints (`/api/reserve/availability`, `/api/reserve/slots`) accept a `guestCount` query param so slot listings reflect per-guest capacity.

---

## Exceptions and Time Off

A resource's schedules can declare `exceptions` — days the resource is unavailable (vacation, sick leave, closures). An exception recorded on **any** of a resource's schedules makes the **whole** resource unavailable that day, not just the schedule it was recorded on. So a part-time resource with separate morning and afternoon schedules is fully off-limits if either schedule has an exception for that date.

Exception `date`–`endDate` ranges are honored inclusively — every calendar day from `date` to `endDate` (both ends included) is blocked.

**The write path enforces schedules for public actors (4.1.2, `enforceSchedule`, default on).** An anonymous `/reserve/book` or `/reserve/hold` call, or any authenticated customer on any path, may not book in the past, and — for a resource that has at least one active schedule — every item's window must fall inside that day's schedule ranges and not on an exception day (`The requested time is outside the resource's schedule`; holds answer `409 outside_schedule`). Staff, and Local API calls with no user, are exempt so walk-ins, imports and seeds are unaffected. A resource with no schedule is unconstrained. Before this the availability endpoints were advisory only.

All day and time resolution — matching a date to a schedule and expanding `HH:mm` slots — runs in the business `timezone` (the plugin-level `timezone` option), so wall-clock schedules behave correctly regardless of server timezone.

**Date-only fields are calendar days, keyed by their UTC date.** `exceptions[].date`, `exceptions[].endDate` and `manualSlots[].date` are Payload `date` fields, so they are stored as instants, but they name a day, not a moment. The day is the UTC calendar date of the stored value: the admin day picker stores noon UTC, and an API- or seed-written `'2025-12-25'` stores midnight UTC — both mean December 25 in every business timezone. (Before 4.1.1 these were re-keyed in the business zone, which turned `'2025-12-25'` into December 24 for any zone west of UTC.) If you write these fields from code, write a bare `'YYYY-MM-DD'` or any instant on that UTC date.

See [Collections → Schedules](./collections.md#schedules) for the exception field shape.

---

## Updating Reservations

Editing an existing reservation re-validates conflicts and recomputes `endTime` only when a **scheduling-relevant** field actually changed: `startTime`, `endTime`, `resource`, `service`, `items`, `guestCount`, or a status transition that enters a blocking status. Benign edits — changing `notes`, or moving status **out** of a blocking status — skip conflict and `endTime` validation entirely.

This means a reservation booked under an older buffer or schedule configuration can still take benign edits even if the buffers or schedules have since changed in a way that would make the original slot conflict. Only genuine scheduling changes are re-checked against current rules.

---

## Guest Bookings

Reservations can be made without a customer account. Enable globally with the `allowGuestBooking` plugin option, or per-service via the service's `allowGuestBooking` field (`inherit` / `enabled` / `disabled`). A guest booking captures inline contact details (`guest.name` plus at least one of `guest.email` / `guest.phone`) instead of a `customer`, and the plugin generates a `cancellationToken` for self-service cancellation (delivered via the `afterBookingCreate` hook, never over the API). See [Guest Bookings](../README.md#guest-bookings) and [Examples](./examples.md).

---

← [Status Machine](./status-machine.md) | → [Hooks API](./hooks-api.md) | ↑ [Back to README](../README.md)

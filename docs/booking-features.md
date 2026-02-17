# Booking Features

Covers duration types, multi-resource bookings, and capacity/inventory management.

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

**Inheritance rules:** Items missing `startTime`, `endTime`, `service`, or `guestCount` inherit the parent reservation's values.

**Conflict detection** runs independently for each resource in the `items` array as well as the primary resource.

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

← [Status Machine](./status-machine.md) | → [Hooks API](./hooks-api.md) | ↑ [Back to README](../README.md)

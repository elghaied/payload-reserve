# Booking Features

## Duration Types

Set on each service via `durationType`. Controls how `endTime` is calculated.

### fixed (default)

`endTime = startTime + service.duration`

Standard appointment mode. Used for haircuts, consultations, classes.

```typescript
{ duration: 60, durationType: 'fixed' }
// 60-minute appointment — endTime always = startTime + 60 min
```

### flexible

`endTime` is provided by the caller. The service `duration` is the minimum; providing less causes rejection.

Used for open-ended services — workspace rentals, recording studios, vehicle bays.

```typescript
{ duration: 30, durationType: 'flexible' }
// Minimum 30 min, but caller can book 90 min by providing endTime

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

### full-day

`endTime = end of calendar day (23:59:59)` relative to `startTime`.

Used for hotel rooms, venue hire, equipment daily rental.

```typescript
{ duration: 480, durationType: 'full-day' }
// Always occupies the entire day
```

---

## Multi-Resource Bookings

A single reservation can include multiple resources simultaneously using the `items` array.
Use for couple's massages (two therapists), weddings (venue + catering), film shoots (studio + equipment).

Top-level fields (`service`, `resource`, `startTime`) represent the primary booking. Additional resources go in `items`:

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
        // service, startTime, endTime, guestCount all inherit from parent
      },
    ],
  },
})
```

**Inheritance:** Items missing `startTime`, `endTime`, `service`, or `guestCount` inherit the parent's values.

**Conflict detection** runs independently for each resource in `items` plus the primary.

---

## Capacity and Inventory

By default each resource allows one concurrent booking. Set `quantity > 1` for inventory mode.

### quantity

Number of concurrent bookings for overlapping windows. The `(quantity + 1)`th booking is rejected.

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Standard Room',
    services: [hotelNightId],
    quantity: 20,                    // 20 identical rooms
    capacityMode: 'per-reservation',
  },
})
```

### capacityMode

Controls how `quantity` is counted. Only relevant when `quantity > 1`.

**`per-reservation` (default):** Each booking = 1 unit, regardless of guest count.
Use for hotel rooms, parking spaces, equipment units.

```
quantity: 5 — allows 5 simultaneous bookings
Booking with guestCount: 3 still occupies 1 slot
```

**`per-guest`:** Each booking = `guestCount` units.
Use for group venues, yoga classes, boat tours.

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Yoga Studio',
    services: [yogaClassId],
    quantity: 20,             // 20 total spots
    capacityMode: 'per-guest',
  },
})
// Booking with guestCount: 3 occupies 3 of the 20 spots
// Room is full when 20 total guests are booked
```

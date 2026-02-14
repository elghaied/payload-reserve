# Hooks & Status State Machine

## Table of Contents

- [Hook Execution Order](#hook-execution-order)
- [calculateEndTime](#calculateendtime)
- [validateConflicts](#validateconflicts)
- [validateStatusTransition](#validatestatustransition)
- [validateCancellation](#validatecancellation)
- [Status State Machine](#status-state-machine)
- [Status Definitions](#status-definitions)
- [Common Workflows](#common-workflows)
- [Escape Hatch](#escape-hatch)

---

## Hook Execution Order

All four hooks are `beforeChange` hooks on the Reservations collection, executing in this order:

1. `calculateEndTime` — compute endTime
2. `validateConflicts` — check for double-booking
3. `validateStatusTransition` — enforce state machine
4. `validateCancellation` — enforce cancellation notice period

All hooks check `context.skipReservationHooks` and skip if truthy.

---

## calculateEndTime

Runs on every create and update. Computes: `endTime = startTime + service.duration (minutes)`.

The `endTime` field is read-only in the admin UI — users cannot override it.

---

## validateConflicts

Prevents double-booking on the same resource:

1. Load the service's `bufferTimeBefore` and `bufferTimeAfter` (falls back to `defaultBufferTime` from plugin config)
2. Compute the **blocked window**: `[startTime - bufferBefore, endTime + bufferAfter]`
3. Query existing reservations for the same resource where status is NOT `cancelled` or `no-show`
4. On updates, exclude the current reservation from the conflict check
5. Throw `ValidationError` if any overlap is found

**Example:**
```
Service: Haircut (30 min, 5 min buffer before, 10 min buffer after)
Reservation: 10:00 - 10:30
Blocked window: 09:55 - 10:40

Another booking at 10:20 on same resource     -> CONFLICT ERROR
Another booking at 10:45 on same resource      -> OK
Another booking at 10:20 on DIFFERENT resource -> OK
```

---

## validateStatusTransition

### On Create

- **Public/unauthenticated**: Status must be `pending` (or unset, defaults to `pending`)
- **Authenticated admin**: Status can be `pending` or `confirmed` (walk-in support)
- Statuses like `completed`, `cancelled`, `no-show` are never allowed on create (without escape hatch)

### On Update

Only valid transitions are allowed (see state machine below). Invalid transitions throw `ValidationError`.

---

## validateCancellation

When transitioning to `cancelled`, checks: `hours_until_appointment >= cancellationNoticePeriod`.

With default `cancellationNoticePeriod: 24`, you cannot cancel a reservation starting within 24 hours. Throws `ValidationError` with details about remaining hours.

---

## Status State Machine

```
              +-> confirmed --+-> completed
              |               |
pending ------+               +-> cancelled
              |               |
              +-> cancelled   +-> no-show
```

### Valid Transitions

| From | Allowed To |
|------|------------|
| `pending` | `confirmed`, `cancelled` |
| `confirmed` | `completed`, `cancelled`, `no-show` |
| `completed` | *(terminal)* |
| `cancelled` | *(terminal)* |
| `no-show` | *(terminal)* |

---

## Status Definitions

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `pending` | Created but not confirmed. Awaiting admin review or payment. Default for all new public reservations. | No |
| `confirmed` | Locked in. Payment received, admin approved, or walk-in by staff. | No |
| `completed` | Appointment took place successfully. Set by admin after service delivery. | Yes |
| `cancelled` | Cancelled before appointment (by customer or admin). Subject to notice period. | Yes |
| `no-show` | Customer didn't show up for a confirmed appointment. Set by admin. | Yes |

Terminal statuses cannot transition to any other status.

---

## Common Workflows

### Online Booking (standard)
```
Customer selects service/resource/time
  -> payload.create({ status: 'pending' })     [endTime calculated, conflicts checked]
  -> Admin reviews
  -> payload.update({ status: 'confirmed' })    [transition validated]
  -> Appointment occurs
  -> payload.update({ status: 'completed' })
```

### Walk-In Booking
```
Staff creates in admin panel
  -> payload.create({ status: 'confirmed' })    [admin user, skips pending]
  -> Appointment occurs
  -> payload.update({ status: 'completed' })
```

### Payment-Gated Booking
```
Customer selects time
  -> payload.create({ status: 'pending' })       [slot held by conflict detection]
  -> Create Stripe Checkout Session
  -> Customer pays
  -> Stripe webhook -> payload.update({ status: 'confirmed' })
  -> Appointment -> 'completed'
```

### Customer Cancellation
```
Customer requests cancellation (from 'pending' or 'confirmed')
  -> payload.update({ status: 'cancelled', cancellationReason: '...' })
  -> Hook checks: hours_until >= cancellationNoticePeriod
  -> Sufficient notice: succeeds
  -> Too late: ValidationError
```

### No-Show Handling
```
Appointment time passes, customer absent
  -> Admin: payload.update({ status: 'no-show' })  [only from 'confirmed']
  -> Terminal — cannot be reopened
```
A `pending` reservation where nobody showed up should be `cancelled`, not `no-show`.

---

## Escape Hatch

All four hooks check `context.skipReservationHooks`. Set to `true` to bypass all validation:

```ts
await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    status: 'completed', // normally fails on create
  },
  context: { skipReservationHooks: true },
})
```

**When to use:**
- Data migrations and seeding
- Administrative corrections
- Scheduled cleanup of stale pending reservations (bypass cancellation notice)

**Not needed for:** Admin quick-confirm (authenticated admins can create as `confirmed` without escape hatch).

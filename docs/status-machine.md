# Status Machine

The status machine controls the full lifecycle of a reservation — which statuses exist, which transitions are allowed, which statuses block a time slot, and which are terminal.

## Default Status Flow

```
pending ---> confirmed ---> completed
        \               \-> cancelled
         \               \-> no-show
          \-> cancelled
```

| Status | Meaning | Blocks slot | Terminal |
|--------|---------|-------------|----------|
| `pending` | Created, awaiting confirmation | Yes | No |
| `confirmed` | Confirmed and time slot committed | Yes | No |
| `completed` | Service was delivered | No | Yes |
| `cancelled` | Cancelled before the appointment | No | Yes |
| `no-show` | Customer did not show up | No | Yes |

**Terminal statuses** cannot transition to anything. Once a reservation is terminal, it is permanently closed.

**Blocking statuses** control which statuses count as occupying the time slot for conflict detection. By default both `pending` and `confirmed` block the slot.

## Custom Status Machine

Override any or all properties via the `statusMachine` option. Unset keys fall back to defaults.

```typescript
payloadReserve({
  statusMachine: {
    statuses: ['requested', 'booked', 'done', 'voided'],
    defaultStatus: 'requested',
    // Decouple confirm/cancel logic from the literal status names.
    // A custom vocabulary MUST set these (see below).
    confirmStatus: 'booked',
    cancelStatus: 'voided',
    terminalStatuses: ['done', 'voided'],
    blockingStatuses: ['requested', 'booked'],
    transitions: {
      requested: ['booked', 'voided'],
      booked: ['done', 'voided'],
      done: [],
      voided: [],
    },
  },
})
```

- The `statuses` array drives the select field options in the admin UI
- The `transitions` map controls which updates `validateStatusTransition` allows
- The `blockingStatuses` array determines which statuses occupy the slot in conflict detection
- The `confirmStatus` (default `'confirmed'`) and `cancelStatus` (default `'cancelled'`) decouple the confirm/cancel logic from the literal status names. They drive the `beforeBookingConfirm`/`afterBookingConfirm`/`beforeBookingCancel`/`afterBookingCancel` plugin hooks, the cancellation notice-period rule, and the `cancellationReason` admin field condition
- The resolved status machine is stored in `config.admin.custom.reservationStatusMachine` for admin component access

> **A custom status vocabulary MUST set `confirmStatus` and `cancelStatus`.** They default to `'confirmed'` and `'cancelled'` — if your statuses don't include those literals, the confirm/cancel hooks, the cancellation notice period, and the `cancellationReason` field condition silently won't fire. The example above sets `confirmStatus: 'booked'` and `cancelStatus: 'voided'`.

The full `StatusMachineConfig` type:

```typescript
type StatusMachineConfig = {
  blockingStatuses: string[]   // statuses that occupy a resource slot
  cancelStatus: string         // status treated as "cancelled" (default 'cancelled')
  confirmStatus: string        // status treated as "confirmed" (default 'confirmed')
  defaultStatus: string        // status assigned on create
  statuses: string[]           // all valid status values
  terminalStatuses: string[]   // statuses from which no transition is allowed
  transitions: Record<string, string[]>  // allowed next statuses per current status
}
```

**Config validation:** The status machine is validated at plugin initialization (skipped when the plugin is `disabled`). Invalid configs throw an error at startup rather than causing silent runtime failures. The checks are:

- `defaultStatus` must be in `statuses` (and must not be terminal — a reservation is born in `defaultStatus`)
- `blockingStatuses` and `terminalStatuses` must reference only known statuses
- transition keys and targets must point to existing statuses
- a terminal status must have no outgoing transitions
- `confirmStatus` and `cancelStatus` must be in `statuses`

## Business Logic Hooks

Thirteen `beforeChange` hooks run on the Reservations collection, in this order:

1. **`limitPublicItems`** — public callers may send at most `maxPublicItems` (default 10) `items[]`
2. **`beforeBookingCreate` plugin hooks** — your own hooks, on create
3. **`enforceCustomerOwnership`** — a signed-in non-staff user can only book, or keep a booking, for themselves; a different `customer` is rewritten to their own id
4. **`checkIdempotency`** — on create, rejects an `idempotencyKey` that has already been used
5. **`validateGuestBooking`** — requires either a `customer` or guest contact details, never both (checked on create and update); on create also applies `allowGuestBooking` and the per-service overrides to every service the booking touches
6. **`expandRequiredResources`** — on create, and on update when `service` changes, adds the service's `requiredResources` to `items[]` so every required pool is occupied
7. **`validateActive`** — rejects a booking, or a reschedule, onto an inactive service or resource (`enforceActive`)
8. **`calculateEndTime`** — computes `endTime` from `startTime + service.duration` (respects `durationType`); validates a `flexible` window; refuses a booking whose end cannot be determined
9. **`validateBookingWindow`** — public callers may not book in the past or outside the resource's schedule (`enforceSchedule`), and a resource that lists `services` can only be booked with one of them (`enforceServiceMatch`)
10. **`acquireBookingLock`** — locks each claimed resource inside the transaction so simultaneous bookers are serialized (see [Concurrent Bookings](./concurrency.md))
11. **`validateConflicts`** — checks each item for overlapping reservations, using blocking statuses, buffer times and capacity
12. **`validateCancellation`** — when moving to `cancelStatus`, the stored start time must be at least `cancellationNoticePeriod` hours away. A customer also may not reschedule inside that window or cancel after the booking has started. Staff are exempt
13. **`validateStatusTransition`** — enforces the transitions in the status machine and fires `beforeBookingConfirm` / `beforeBookingCancel`. On create, new bookings start in `defaultStatus` (staff can also use statuses reachable from it; use `context.allowConfirmedOnCreate` for programmatic bypass). On update, a signed-in non-staff user may only move a booking to `cancelStatus`

Two `afterChange` hooks also run:

- **`createPluginHooksAfterCreate`** — on create, fires the `afterBookingCreate` plugin hooks
- **`onStatusChange`** — on update, detects status changes and fires `afterStatusChange`, `afterBookingConfirm` and `afterBookingCancel` (each wrapped in try-catch — errors are logged, not thrown)

On a validation dry run (`payload.validate`, Payload 4) the same checks run and nothing is saved; `beforeBookingConfirm` / `beforeBookingCancel` are not fired.

## Escape Hatch

All hooks — both `beforeChange` and `afterChange` (including `onStatusChange`) — check `context.skipReservationHooks` and exit immediately when truthy. Use this for data migrations, seeding, and programmatic administrative operations where you want to handle side-effects (emails, payments) manually:

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
  overrideAccess: true,
})
```

This is especially important for programmatic bulk updates. If you update a reservation's status with `skipReservationHooks: true`, the `afterBookingCancel` / `afterBookingConfirm` / `afterStatusChange` callbacks are **not** fired — preventing double-sends when you handle the notification yourself:

```typescript
// Cancel a stale reservation manually — no double email
await req.payload.update({
  collection: 'reservations',
  id: reservation.id,
  data: { status: 'cancelled' },
  context: { skipReservationHooks: true },
  req,
  overrideAccess: true,
})
// Now send your own cancellation email
await sendCancellationEmail(reservation)
```

---

← [Collections](./collections.md) | → [Booking Features](./booking-features.md) | ↑ [Back to README](../README.md)

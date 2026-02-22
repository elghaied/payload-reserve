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
    statuses: ['requested', 'approved', 'in-progress', 'done', 'cancelled'],
    defaultStatus: 'requested',
    terminalStatuses: ['done', 'cancelled'],
    blockingStatuses: ['approved', 'in-progress'],
    transitions: {
      requested: ['approved', 'cancelled'],
      approved: ['in-progress', 'cancelled'],
      'in-progress': ['done', 'cancelled'],
      done: [],
      cancelled: [],
    },
  },
})
```

- The `statuses` array drives the select field options in the admin UI
- The `transitions` map controls which updates `validateStatusTransition` allows
- The `blockingStatuses` array determines which statuses occupy the slot in conflict detection
- The resolved status machine is stored in `config.admin.custom.reservationStatusMachine` for admin component access

## Business Logic Hooks

Four `beforeChange` hooks run on the Reservations collection on every create and update:

1. **`checkIdempotency`** — Rejects creates where `idempotencyKey` has already been used
2. **`calculateEndTime`** — Computes `endTime` from `startTime + service.duration` (respects `durationType`)
3. **`validateConflicts`** — Checks for overlapping reservations on the same resource using blocking statuses and buffer times
4. **`validateStatusTransition`** — Enforces allowed transitions defined in the status machine; on create, enforces that new bookings start in `defaultStatus`
5. **`validateCancellation`** — When transitioning to `cancelled`, verifies the appointment is at least `cancellationNoticePeriod` hours away

One `afterChange` hook also runs:

6. **`onStatusChange`** — Detects status changes; fires `afterStatusChange`, `afterBookingConfirm`, and `afterBookingCancel` plugin hooks

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
})
// Now send your own cancellation email
await sendCancellationEmail(reservation)
```

---

← [Collections](./collections.md) | → [Booking Features](./booking-features.md) | ↑ [Back to README](../README.md)

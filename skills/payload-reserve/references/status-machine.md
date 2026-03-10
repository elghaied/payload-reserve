# Status Machine

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

**Blocking statuses** determine which statuses count as occupying a slot for conflict detection.
**Terminal statuses** cannot transition to anything — the record is permanently closed.

## Custom Status Machine

Override any or all keys via `statusMachine`. Unset keys fall back to defaults.

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

- `statuses` drives the select field options in admin UI
- `transitions` controls which updates `validateStatusTransition` allows
- `blockingStatuses` determines which statuses occupy a slot in conflict detection
- The resolved machine is stored in `config.admin.custom.reservationStatusMachine` for admin components

**Config validation:** The status machine is validated at plugin initialization. Invalid configs — such as a `defaultStatus` not in `statuses`, `blockingStatuses` or `terminalStatuses` referencing unknown statuses, or transition keys/targets pointing to non-existent statuses — throw an error at startup rather than causing silent runtime failures.

## Business Logic Hooks (automatic — always run)

These `beforeChange` hooks run on every create/update of the Reservations collection:

1. **`checkIdempotency`** — rejects creates where `idempotencyKey` already exists
2. **`calculateEndTime`** — computes `endTime` from `startTime + service.duration`
3. **`validateConflicts`** — checks overlapping reservations per resource (blocking statuses + buffer times)
4. **`validateStatusTransition`** — enforces the transitions map; new bookings must start at `defaultStatus` (admin users can also use statuses reachable from `defaultStatus`; use `context.allowConfirmedOnCreate` for programmatic bypass)
5. **`validateCancellation`** — when transitioning to `cancelled`, verifies `cancellationNoticePeriod` hours remain

After change:

6. **`onStatusChange`** — fires `afterStatusChange`, `afterBookingConfirm`, `afterBookingCancel` plugin hooks

## Escape Hatch

All hooks — both `beforeChange` and `afterChange` (including `onStatusChange`) — check `context.skipReservationHooks` and exit immediately when truthy. Use for data migrations, seeding, and admin operations:

```typescript
await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    status: 'completed', // normally blocked — bypassed here
  },
  context: { skipReservationHooks: true },
})
```

When you update a reservation's status with `skipReservationHooks: true`, the `afterBookingCancel` / `afterBookingConfirm` / `afterStatusChange` callbacks are **not** fired — preventing double-sends when you handle the notification yourself:

```typescript
await req.payload.update({
  collection: 'reservations',
  id: reservation.id,
  data: { status: 'cancelled' },
  context: { skipReservationHooks: true },
  req,
})
await sendCancellationEmail(reservation)
```

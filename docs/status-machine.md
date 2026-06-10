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

Seven `beforeChange` hooks run on the Reservations collection. They fire in this order (after the plugin's `beforeBookingCreate` integration hooks):

1. **`checkIdempotency`** — On create, rejects creates where `idempotencyKey` has already been used
2. **`validateGuestBooking`** — On create, requires either a `customer` or guest contact details (and rejects supplying both); driven by the `allowGuestBooking` config and per-service overrides
3. **`expandRequiredResources`** — On create, expands the service's `requiredResources` into the reservation's `items[]` so every required resource pool is occupied (runs before `calculateEndTime`/`validateConflicts` so appended items get end times and are conflict-checked)
4. **`calculateEndTime`** — Computes `endTime` from `startTime + service.duration` (respects `durationType`)
5. **`validateConflicts`** — Checks for overlapping reservations per item using blocking statuses and buffer times
6. **`validateStatusTransition`** — Enforces allowed transitions defined in the status machine; on create, enforces that new bookings start in `defaultStatus` (admin/staff users can also use statuses reachable from `defaultStatus`; use `context.allowConfirmedOnCreate` for programmatic bypass)
7. **`validateCancellation`** — When transitioning to `cancelled`, verifies the appointment is at least `cancellationNoticePeriod` hours away

Two `afterChange` hooks also run:

8. **`createPluginHooksAfterCreate`** — On create, fires the `afterBookingCreate` plugin hooks
9. **`onStatusChange`** — Detects status changes; fires `afterStatusChange`, `afterBookingConfirm`, and `afterBookingCancel` plugin hooks (each wrapped in try-catch — errors are logged, not thrown)

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

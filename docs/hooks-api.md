# Hooks API

The plugin exposes hook callbacks that fire at key points in the booking lifecycle. Register them in the `hooks` option. All hooks receive the `req` object (Payload request) so you have access to the full Payload instance and request context.

```typescript
import type { ReservationPluginHooks } from 'payload-reserve'

const hooks: ReservationPluginHooks = {
  // ... hook definitions
}

payloadReserve({ hooks })
```

Each hook type is an array — hooks fire sequentially.

> **Escape hatch:** All plugin hooks respect `context.skipReservationHooks`. When you call `payload.update()` or `payload.create()` with `context: { skipReservationHooks: true }`, none of these callbacks fire — including the `afterChange` hooks that trigger `afterBookingCancel`, `afterBookingConfirm`, and `afterStatusChange`. Use this when your code handles the side-effect (email, payment) itself and must not double-fire.

---

## beforeBookingCreate

Fires before a new reservation is saved via the `POST /api/reserve/book` endpoint. Can modify the booking data. It fires **exactly once** per booking (it is registered as a collection `beforeChange` hook; the endpoint no longer runs it a second time).

On the `/api/reserve/book` endpoint it therefore runs **inside** the collection `beforeChange` — after Payload's field validation — rather than against the raw request body. A hook that needs to stamp a *required* field should read it off the merged document at that point rather than assume it can inject it before validation runs.

```typescript
type beforeBookingCreate = Array<
  (args: {
    data: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<Record<string, unknown>> | Record<string, unknown>
>
```

Return the (optionally modified) data. Returning `undefined` keeps the original data.

```typescript
hooks: {
  beforeBookingCreate: [
    async ({ data, req }) => {
      // Attach the logged-in user as the customer
      if (req.user && !data.customer) {
        return { ...data, customer: req.user.id }
      }
      return data
    },
  ],
}
```

---

## beforeBookingConfirm

Fires before a reservation transitions to the configured `statusMachine.confirmStatus` (default `'confirmed'`). Throw an error to block the transition. If you use a custom status vocabulary, set `confirmStatus` in the status machine and the hook fires on that status.

The `doc` contains the merged document (`{ ...originalDoc, ...incomingData }`), so fields like `status` reflect the **new** value being set.

```typescript
type beforeBookingConfirm = Array<
  (args: {
    doc: Record<string, unknown>
    newStatus: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  beforeBookingConfirm: [
    async ({ doc, req }) => {
      // Verify payment before confirming
      const paid = await checkPaymentStatus(doc.stripeSessionId as string)
      if (!paid) {
        throw new Error('Payment not completed')
      }
    },
  ],
}
```

---

## beforeBookingCancel

Fires before a reservation transitions to the configured `statusMachine.cancelStatus` (default `'cancelled'`). Throw an error to block the cancellation. If you use a custom status vocabulary, set `cancelStatus` in the status machine and the hook fires on that status.

It fires **only after** the cancellation notice period is validated (`validateCancellation` runs before `validateStatusTransition`). A cancellation rejected by the notice period never reaches this hook — so refund/side-effect hooks do not run for a cancel that won't land.

The `doc` contains the merged document (`{ ...originalDoc, ...incomingData }`). The `reason` is passed as a separate parameter from the incoming cancellation data.

```typescript
type beforeBookingCancel = Array<
  (args: {
    doc: Record<string, unknown>
    reason?: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  beforeBookingCancel: [
    async ({ doc, reason }) => {
      await notifyResourceOfCancellation(doc, reason)
    },
  ],
}
```

---

## afterBookingCreate

Fires after a new reservation is saved to the database. Respects `context.skipReservationHooks` — a create that sets the escape hatch (seeds, migrations) does not fire it.

```typescript
type afterBookingCreate = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingCreate: [
    async ({ doc, req }) => {
      await sendBookingConfirmationEmail(doc)
      await slackNotify(`New booking: ${doc.id}`)
    },
  ],
}
```

---

## afterBookingConfirm

Fires after a reservation transitions to the configured `statusMachine.confirmStatus` (default `'confirmed'`). Errors thrown in after-hooks are caught and logged — they do not cause the API response to fail.

```typescript
type afterBookingConfirm = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingConfirm: [
    async ({ doc }) => {
      await sendConfirmationEmail(doc)
      await addToCalendar(doc)
    },
  ],
}
```

---

## afterBookingCancel

Fires after a reservation transitions to the configured `statusMachine.cancelStatus` (default `'cancelled'`). Errors thrown in after-hooks are caught and logged — they do not cause the API response to fail.

```typescript
type afterBookingCancel = Array<
  (args: {
    doc: Record<string, unknown>
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterBookingCancel: [
    async ({ doc }) => {
      await sendCancellationEmail(doc)
      await releaseStripeHold(doc.stripePaymentIntentId as string)
    },
  ],
}
```

---

## afterStatusChange

Generic hook that fires on every status transition. Errors thrown in after-hooks are caught and logged — they do not cause the API response to fail.

It fires **only on a real transition during an update** — never on create. (Previously it fired spuriously on every create with `previousStatus: undefined`; use `afterBookingCreate` for creation side-effects.)

```typescript
type afterStatusChange = Array<
  (args: {
    doc: Record<string, unknown>
    newStatus: string
    previousStatus: string
    req: PayloadRequest
  }) => Promise<void> | void
>
```

```typescript
hooks: {
  afterStatusChange: [
    async ({ doc, newStatus, previousStatus }) => {
      console.log(`Reservation ${doc.id}: ${previousStatus} -> ${newStatus}`)
      await auditLog.record({ docId: doc.id, event: 'status_change', newStatus, previousStatus })
    },
  ],
}
```

---

## Staff Resource Provisioning (user-collection hook)

Separate from the booking-lifecycle hooks above, when `staffProvisioning` is configured (which also requires `resourceOwnerMode`), the plugin registers an `afterChange` hook on the staff **user collection** (`staffProvisioning.userCollection`, defaulting to the top-level `userCollection`).

On user **create** — or on an **update** that promotes a user into a staff role — it provisions a paired Resource owned by that user:

- **Role match** — fires only when the user's `roleField` (default `'role'`) value intersects `staffRoles`. Demoting a user never deletes their Resource.
- **Idempotent** — idempotency comes from a dedup-by-owner query (not an early "was already staff" return): it skips only when a Resource already owns that user, so re-saving never creates a duplicate. Because the check is query-based, a pre-existing staff user (granted a staff role after the fact) and a user whose Resource was deleted are both (re)provisioned on their next save.
- **Impersonation-based ownership** — the Resource is created with a `req` whose `user` is the new staff user, so the owner field resolves to them (not the admin who triggered the save); no bypass flag is used.
- **Non-blocking** — provisioning failures are caught and logged; they never block the user create/update.
- **Respects `context.skipReservationHooks`** — exits immediately when set.
- **`beforeCreate` escape hatch** — `staffProvisioning.beforeCreate({ data, req, user })` may stamp tenant IDs or custom fields onto the Resource before it is saved.

See the **Staff Auto-Provisioning** section of the [README](../README.md#staff-scheduling) and the [Configuration](./configuration.md) docs for the full option list.

---

← [Booking Features](./booking-features.md) | → [REST API](./rest-api.md) | ↑ [Back to README](../README.md)

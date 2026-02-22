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

Fires before a new reservation is saved via the `POST /api/reserve/book` endpoint. Can modify the booking data.

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

Fires before a reservation transitions to `confirmed`. Throw an error to block the transition.

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

Fires before a reservation transitions to `cancelled`. Throw an error to block the cancellation.

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

Fires after a new reservation is saved to the database.

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

Fires after a reservation transitions to `confirmed`.

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

Fires after a reservation transitions to `cancelled`.

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

Generic hook that fires on every status transition.

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

← [Booking Features](./booking-features.md) | → [REST API](./rest-api.md) | ↑ [Back to README](../README.md)

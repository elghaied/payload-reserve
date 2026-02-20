# Hooks API

Plugin hook callbacks that fire at key points in the booking lifecycle. Register in the `hooks` option. All hooks receive `req` (Payload request) for full Payload instance access. Each hook type is an array — hooks fire sequentially.

```typescript
import type { ReservationPluginHooks } from 'payload-reserve'

payloadReserve({ hooks: { /* ... */ } })
```

---

## beforeBookingCreate

Fires before a new reservation is saved via `POST /api/reserve/book`. Can modify booking data.

```typescript
type beforeBookingCreate = Array<
  (args: { data: Record<string, unknown>; req: PayloadRequest }) =>
    Promise<Record<string, unknown>> | Record<string, unknown>
>
```

Return modified data or `undefined` to keep original.

```typescript
hooks: {
  beforeBookingCreate: [
    async ({ data, req }) => {
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

Fires before a reservation transitions to `confirmed`. Throw to block the transition.

```typescript
type beforeBookingConfirm = Array<
  (args: { doc: Record<string, unknown>; newStatus: string; req: PayloadRequest }) =>
    Promise<void> | void
>
```

```typescript
hooks: {
  beforeBookingConfirm: [
    async ({ doc, req }) => {
      const paid = await checkPaymentStatus(doc.stripeSessionId as string)
      if (!paid) throw new Error('Payment not completed')
    },
  ],
}
```

---

## beforeBookingCancel

Fires before a reservation transitions to `cancelled`. Throw to block.

```typescript
type beforeBookingCancel = Array<
  (args: { doc: Record<string, unknown>; reason?: string; req: PayloadRequest }) =>
    Promise<void> | void
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
  (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
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
  (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
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
  (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
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
      await auditLog.record({ docId: doc.id, event: 'status_change', newStatus, previousStatus })
    },
  ],
}
```

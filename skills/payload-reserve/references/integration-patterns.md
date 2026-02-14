# Integration Patterns

## Table of Contents

- [Stripe Payment Integration](#stripe-payment-integration)
- [Notification Integration](#notification-integration)
- [Scheduled Cleanup](#scheduled-cleanup)

---

## Stripe Payment Integration

The `pending -> confirmed` transition fits payment-gated bookings. The reservation holds the time slot while payment processes (conflict detection ran on create).

### Flow

1. Customer creates reservation -> status `pending`, slot is held
2. App creates Stripe Checkout Session with reservation ID in metadata
3. Customer completes payment on Stripe's hosted page
4. Stripe sends `checkout.session.completed` webhook
5. Webhook handler updates reservation to `confirmed`
6. If payment fails/expires, reservation stays `pending` for cleanup

### Webhook Handler

```ts
// app/api/stripe-webhook/route.ts
import { getPayload } from 'payload'
import config from '@payload-config'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  const event = stripe.webhooks.constructEvent(
    body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET!,
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const reservationId = session.metadata?.reservationId

    if (reservationId) {
      const payload = await getPayload({ config })
      await payload.update({
        collection: 'reservations',
        id: reservationId,
        data: { status: 'confirmed' },
      })
    }
  }

  return new Response('OK', { status: 200 })
}
```

---

## Notification Integration

Use Payload's `afterChange` hook on Reservations (in your app config, outside the plugin) to trigger notifications on status changes. The plugin does not send notifications — giving you full control.

### Example Scenarios

- **Confirmed**: Send confirmation email with appointment details
- **Upcoming reminder**: Trigger reminder 24h before (via scheduled task)
- **Cancelled**: Notify customer, optionally alert staff about freed slot
- **No-show**: Notify staff for internal tracking

### Example Hook

```ts
// Add to your payload.config.ts via collections override or separate plugin
import type { CollectionAfterChangeHook } from 'payload'

const notifyOnStatusChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
}) => {
  if (operation === 'update' && doc.status !== previousDoc.status) {
    switch (doc.status) {
      case 'confirmed':
        await sendConfirmationEmail(doc)
        break
      case 'cancelled':
        await sendCancellationEmail(doc)
        break
    }
  }
}
```

---

## Scheduled Cleanup

Pending reservations that are never paid hold time slots. Set up a scheduled task to cancel stale ones:

```ts
// Example: cron job or scheduled task
import { getPayload } from 'payload'
import config from '@payload-config'

const payload = await getPayload({ config })

const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

const { docs: staleReservations } = await payload.find({
  collection: 'reservations',
  where: {
    status: { equals: 'pending' },
    createdAt: { less_than: thirtyMinutesAgo.toISOString() },
  },
})

for (const reservation of staleReservations) {
  await payload.update({
    collection: 'reservations',
    id: reservation.id,
    data: {
      status: 'cancelled',
      cancellationReason: 'Automatically cancelled - payment not completed',
    },
    context: { skipReservationHooks: true }, // bypass cancellation notice period
  })
}
```

**Key:** Use `context: { skipReservationHooks: true }` to bypass the cancellation notice period for automated cleanup.

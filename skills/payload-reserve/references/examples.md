# Examples

Real-world configurations and integration patterns.

## Use Cases

### Salon / Barbershop

Staff are resources, services are treatments.

```typescript
payloadReserve({
  adminGroup: 'Salon',
  defaultBufferTime: 0,
  cancellationNoticePeriod: 24,
  slugs: {
    resources: 'stylists',
    services: 'treatments',
    reservations: 'appointments',
  },
})
```

Typical service: `{ duration: 30, durationType: 'fixed', bufferTimeAfter: 10 }`

---

### Hotel

Rooms are resources with `quantity` equal to the number of identical room types. Use `full-day` duration.

```typescript
payloadReserve({
  adminGroup: 'Hotel',
  cancellationNoticePeriod: 48,
  slugs: { resources: 'rooms', services: 'room-types', reservations: 'bookings' },
})

await payload.create({
  collection: 'room-types',
  data: { name: 'Standard Double', duration: 1440, durationType: 'full-day', price: 149.00 },
})

await payload.create({
  collection: 'rooms',
  data: { name: 'Standard Double', services: [standardDoubleId], quantity: 10, capacityMode: 'per-reservation' },
})
```

---

### Restaurant / Event Space

Group bookings where total guest count matters. Use `per-guest` capacity mode.

```typescript
payloadReserve({ adminGroup: 'Restaurant', cancellationNoticePeriod: 2 })

await payload.create({
  collection: 'resources',
  data: { name: 'Main Dining Room', services: [diningServiceId], quantity: 60, capacityMode: 'per-guest' },
})
```

Bookings with `guestCount: 4` occupy 4 of 60 seats.

---

### Event Venue (Custom Status Machine)

Approval workflow before confirming. Custom statuses with business logic hooks.

```typescript
payloadReserve({
  adminGroup: 'Events',
  statusMachine: {
    statuses: ['enquiry', 'quote-sent', 'deposit-paid', 'confirmed', 'completed', 'cancelled'],
    defaultStatus: 'enquiry',
    terminalStatuses: ['completed', 'cancelled'],
    blockingStatuses: ['deposit-paid', 'confirmed'],
    transitions: {
      enquiry: ['quote-sent', 'cancelled'],
      'quote-sent': ['deposit-paid', 'cancelled'],
      'deposit-paid': ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    },
  },
  hooks: {
    afterStatusChange: [
      async ({ doc, newStatus }) => {
        if (newStatus === 'quote-sent') await sendQuoteEmail(doc)
        if (newStatus === 'confirmed') await sendContractEmail(doc)
      },
    ],
  },
})
```

---

## Integration Patterns

### Stripe Payment Gate

Hold the slot with `pending` while customer pays. Confirm via webhook.

```typescript
// 1. Create reservation (slot held, pending status)
const reservation = await payload.create({
  collection: 'reservations',
  data: { service: serviceId, resource: resourceId, customer: customerId, startTime: selectedSlot },
})

// 2. Create Stripe Checkout Session with reservation ID in metadata
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: stripePriceId, quantity: 1 }],
  metadata: { reservationId: String(reservation.id) },
  mode: 'payment',
  success_url: `${process.env.NEXT_PUBLIC_URL}/booking/success`,
  cancel_url: `${process.env.NEXT_PUBLIC_URL}/booking/cancel`,
})

// 3. Confirm in Stripe webhook handler (app/api/stripe-webhook/route.ts)
export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)

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

### Email Notifications

```typescript
payloadReserve({
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        const customer = await req.payload.findByID({
          collection: 'customers',
          id: doc.customer as string,
          depth: 0,
          req,
        })
        await sendEmail({
          subject: 'Booking received',
          template: 'booking-created',
          to: customer.email as string,
          variables: { bookingId: doc.id, startTime: doc.startTime },
        })
      },
    ],
    afterStatusChange: [
      async ({ doc, newStatus }) => {
        if (newStatus === 'confirmed') await sendEmail({ template: 'booking-confirmed', variables: doc })
        if (newStatus === 'cancelled') await sendEmail({ template: 'booking-cancelled', variables: doc })
      },
    ],
  },
})
```

---

### Multi-Tenant

Scope all queries to a tenant via access control + `beforeBookingCreate`.

```typescript
payloadReserve({
  access: {
    reservations: {
      read: ({ req }) => {
        if (!req.user) return false
        return { tenant: { equals: req.user.tenant } }
      },
      create: ({ req }) => !!req.user,
    },
  },
  hooks: {
    beforeBookingCreate: [
      async ({ data, req }) => {
        return { ...data, tenant: req.user?.tenant }
      },
    ],
  },
})
```

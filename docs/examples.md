# Examples

Real-world use case configurations and integration patterns.

## Use Cases

### Salon / Barbershop

Staff are resources, services are treatments. Each stylist has their own recurring weekly schedule.

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

Typical services: `duration: 30, durationType: 'fixed', bufferTimeAfter: 10`

---

### Hotel

Rooms are resources with `quantity` equal to the number of identical rooms of that type. Each guest stays for a full calendar day — use `full-day` duration.

```typescript
payloadReserve({
  adminGroup: 'Hotel',
  cancellationNoticePeriod: 48,
  slugs: {
    resources: 'rooms',
    services: 'room-types',
    reservations: 'bookings',
  },
})

// Room type service
await payload.create({
  collection: 'room-types',
  data: {
    name: 'Standard Double',
    duration: 1440,
    durationType: 'full-day',
    price: 149.00,
  },
})

// Room resource (10 identical standard doubles)
await payload.create({
  collection: 'rooms',
  data: {
    name: 'Standard Double',
    services: [standardDoubleId],
    quantity: 10,
    capacityMode: 'per-reservation',
  },
})
```

---

### Restaurant / Event Space

Group bookings where total guest count matters. Use `per-guest` capacity mode with a maximum party size enforced via `guestCount`.

```typescript
payloadReserve({
  adminGroup: 'Restaurant',
  cancellationNoticePeriod: 2,
})

// Dining room resource (max 60 guests total)
await payload.create({
  collection: 'resources',
  data: {
    name: 'Main Dining Room',
    services: [diningServiceId],
    quantity: 60,
    capacityMode: 'per-guest',
  },
})
```

Bookings with `guestCount: 4` occupy 4 of the 60 total seats. The room is full when total booked guests reach 60.

---

### Event Venue (Custom Status Machine)

Events go through an approval workflow before being confirmed. Use a custom status machine.

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
        if (newStatus === 'quote-sent') {
          await sendQuoteEmail(doc)
        }
        if (newStatus === 'confirmed') {
          await sendContractEmail(doc)
        }
      },
    ],
  },
})
```

### Staff Scheduling with Auto-Provisioning

Every staff user automatically gets a paired bookable Resource they own. Opt in with `staffProvisioning` (requires `resourceOwnerMode`). When a user is created or updated with a staff role, a Resource is created and owned by that user — idempotently, and never auto-deleted on demotion.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'], // these roles see all records
    ownerField: 'owner',
  },
  staffProvisioning: {
    staffRoles: ['stylist', 'therapist'], // users with these roles get a Resource
    roleField: 'role', // user field holding the role (default 'role')
    resourceType: 'staff', // stamped on the Resource (must be a valid resourceType)
    nameFrom: 'name', // user field copied into Resource.name (falls back to email)
    // Optional: stamp tenant / custom fields before the Resource is saved
    beforeCreate: ({ data, user }) => ({ ...data, tenant: user.tenant }),
  },
})
```

The Resource is created by impersonating the staff user, so `resource.owner` is always the user themselves. Provisioning is non-blocking — failures are logged and never block user create/update. Staff can then manage their own schedule (including `endDate`/`type` time-off on `Schedule.exceptions`).

### Guest Bookings (No Account Required)

Allow bookings without a customer account. Enable globally with `allowGuestBooking`, or per-service via the service's `allowGuestBooking` field (`enabled` / `disabled` / `inherit`). A guest booking must supply `guest.name` plus at least one of `guest.email` / `guest.phone` (and must NOT also set `customer`).

```typescript
payloadReserve({
  allowGuestBooking: true, // plugin-wide default; services can override
})

// A guest booking via the public endpoint
await fetch('/api/reserve/book', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service: serviceId,
    resource: resourceId,
    startTime: selectedSlot,
    guest: { name: 'Jamie Doe', email: 'jamie@example.com' },
  }),
})
```

On a guest booking the plugin generates a `cancellationToken`. It is **never** returned in the HTTP response and is **not** readable by customer-collection users — deliver it to the guest yourself via the `afterBookingCreate` hook:

```typescript
payloadReserve({
  allowGuestBooking: true,
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        const guest = doc.guest as { email?: string; name?: string } | undefined
        if (guest?.email && doc.cancellationToken) {
          await sendEmail({
            to: guest.email,
            template: 'guest-booking',
            variables: {
              name: guest.name,
              // Build your own cancel link with the token (POST /api/reserve/cancel with { reservationId, token })
              cancelUrl: `${process.env.NEXT_PUBLIC_URL}/cancel?id=${doc.id}&token=${doc.cancellationToken}`,
            },
          })
        }
      },
    ],
  },
})
```

### Multi-Resource Bookings (Required Resource Pools)

A service can require extra resource pools beyond the primary resource — e.g. a treatment that needs both a therapist and a room, or a salon haircut that occupies a chair. List them on the service's `requiredResources` (relationship, hasMany). On create, the plugin auto-expands them into the reservation's `items[]`, and conflict detection runs per item.

```typescript
// Service that needs a therapist (primary) AND a treatment room (required pool)
await payload.create({
  collection: 'services',
  data: {
    name: 'Hot Stone Massage',
    duration: 60,
    durationType: 'fixed',
    requiredResources: [treatmentRoomPoolId],
  },
})

// Booking the primary resource — the room pool is expanded automatically
await payload.create({
  collection: 'reservations',
  data: {
    service: hotStoneServiceId,
    resource: therapistId, // primary resource
    customer: customerId,
    startTime: selectedSlot,
    // items[] is populated automatically with the required room pool
  },
})
```

If any required pool is fully booked at that time, the create fails with a conflict error that identifies the offending item (e.g. `items.1.startTime`).

### Configurable Vocabularies (Resource Types & Leave Types)

`resourceType` (on Resources) and `exceptions[].type` (on Schedules) draw from configurable string vocabularies. The first `resourceTypes` entry is the field default. These are descriptive only — they drive no business logic.

```typescript
payloadReserve({
  resourceTypes: ['practitioner', 'room', 'equipment'], // default value is 'practitioner'
  leaveTypes: ['vacation', 'sick', 'conference', 'closure'],
})
```

Both must be non-empty arrays. When `staffProvisioning.resourceType` is set, it must be one of `resourceTypes`.

---

## Integration Patterns

### Stripe Payment Gate

Hold the time slot with a `pending` reservation while the customer pays. Confirm on successful payment.

```typescript
// 1. Create reservation on your booking page (slot is held, conflict detection runs)
const reservation = await payload.create({
  collection: 'reservations',
  data: {
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: selectedSlot,
  },
  // status defaults to 'pending'
})

// 2. Create a Stripe Checkout Session with the reservation ID in metadata
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: stripePriceId, quantity: 1 }],
  metadata: { reservationId: String(reservation.id) },
  mode: 'payment',
  success_url: `${process.env.NEXT_PUBLIC_URL}/booking/success`,
  cancel_url: `${process.env.NEXT_PUBLIC_URL}/booking/cancel`,
})

// 3. In your Stripe webhook handler, confirm the reservation
// app/api/stripe-webhook/route.ts
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
        context: { skipReservationHooks: false }, // hooks run — validates transition
      })
    }
  }

  return new Response('OK', { status: 200 })
}
```

---

### Email Notifications

Use `afterBookingCreate` and `afterStatusChange` hooks to send transactional emails:

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
      async ({ doc, newStatus, req }) => {
        if (newStatus === 'confirmed') {
          await sendEmail({ template: 'booking-confirmed', variables: doc })
        }
        if (newStatus === 'cancelled') {
          await sendEmail({ template: 'booking-cancelled', variables: doc })
        }
      },
    ],
  },
})
```

---

### Multi-Tenant Deployments

Scope all queries to a tenant using `beforeBookingCreate` to inject tenant metadata, and access control functions to filter by tenant:

```typescript
payloadReserve({
  access: {
    reservations: {
      read: ({ req }) => {
        if (!req.user) {return false}
        return { tenant: { equals: req.user.tenant } }
      },
      create: ({ req }) => !!req.user,
    },
  },
  hooks: {
    beforeBookingCreate: [
      async ({ data, req }) => {
        // Inject tenant ID from the authenticated user
        return { ...data, tenant: req.user?.tenant }
      },
    ],
  },
})
```

---

← [Admin UI](./admin-ui.md) | → [Advanced](./advanced.md) | ↑ [Back to README](../README.md)

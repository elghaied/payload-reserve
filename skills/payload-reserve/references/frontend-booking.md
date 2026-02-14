# Frontend Booking Integration Guide

## Table of Contents

- [Overview](#overview)
- [Step 1: Configure Access Control](#step-1-configure-access-control)
- [Step 2: Fetch Services](#step-2-fetch-services)
- [Step 3: Fetch Resources for a Service](#step-3-fetch-resources-for-a-service)
- [Step 4: Check Availability](#step-4-check-availability)
- [Step 5: Create the Reservation](#step-5-create-the-reservation)
- [Security Notes](#security-notes)
- [Alternative: REST API](#alternative-rest-api)

---

## Overview

The plugin is backend-only — it adds collections, hooks, and admin UI but no customer-facing pages. Build a booking flow using Payload's Local API (Server Components / Server Actions) or REST API. No custom endpoints needed.

---

## Step 1: Configure Access Control

By default all collections use Payload's default access (authenticated only). For public booking, pass `access` overrides:

```ts
payloadReserve({
  access: {
    services: {
      read: () => true,       // anyone can browse services
    },
    resources: {
      read: () => true,       // anyone can browse resources
    },
    schedules: {
      read: () => true,       // anyone can check availability
    },
    reservations: {
      create: () => true,     // guests can book
      read: ({ req }) => {
        if (req.user) return true  // logged-in users see their reservations
        return false
      },
    },
  },
})
```

**Important:** Access control for the Users collection itself is defined on the Users collection config, not via the plugin's `access` option.

**Critical:** Always use `overrideAccess: false` in frontend queries so access rules are enforced.

---

## Step 2: Fetch Services

```tsx
// app/book/page.tsx (Server Component)
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function BookingPage() {
  const payload = await getPayload({ config })
  const { docs: services } = await payload.find({
    collection: 'services',
    overrideAccess: false,
    where: { active: { equals: true } },
  })

  return (
    <ul>
      {services.map((service) => (
        <li key={service.id}>
          {service.name} - {service.duration} min - ${service.price}
        </li>
      ))}
    </ul>
  )
}
```

---

## Step 3: Fetch Resources for a Service

```ts
const { docs: resources } = await payload.find({
  collection: 'resources',
  overrideAccess: false,
  where: {
    services: { contains: selectedServiceId },
    active: { equals: true },
  },
})
```

---

## Step 4: Check Availability

Fetch the resource's schedule and existing reservations, then compute open slots:

```ts
import {
  resolveScheduleForDate,
  addMinutes,
  doRangesOverlap,
  computeBlockedWindow,
} from 'payload-reserve'

// 1. Get the resource's active schedule
const { docs: schedules } = await payload.find({
  collection: 'schedules',
  overrideAccess: false,
  where: {
    resource: { equals: resourceId },
    active: { equals: true },
  },
})

// 2. Resolve available time ranges for the target date
const targetDate = new Date('2025-03-15')
const availableRanges = schedules.flatMap((schedule) =>
  resolveScheduleForDate(schedule, targetDate),
)

// 3. Fetch existing reservations for that resource on that date
const dayStart = new Date(targetDate)
dayStart.setHours(0, 0, 0, 0)
const dayEnd = new Date(targetDate)
dayEnd.setHours(23, 59, 59, 999)

const { docs: existingReservations } = await payload.find({
  collection: 'reservations',
  overrideAccess: false,
  where: {
    resource: { equals: resourceId },
    startTime: { greater_than_equal: dayStart.toISOString() },
    startTime: { less_than: dayEnd.toISOString() },
    status: { not_equals: 'cancelled' },
  },
})

// 4. Generate slots by stepping through available ranges
const slots = []
for (const range of availableRanges) {
  let cursor = range.start
  while (addMinutes(cursor, serviceDuration) <= range.end) {
    const slotEnd = addMinutes(cursor, serviceDuration)
    const blocked = existingReservations.some((res) => {
      const window = computeBlockedWindow(
        new Date(res.startTime),
        new Date(res.endTime),
        service.bufferTimeBefore ?? 0,
        service.bufferTimeAfter ?? 0,
      )
      return doRangesOverlap(cursor, slotEnd, window.start, window.end)
    })
    if (!blocked) slots.push(cursor)
    cursor = addMinutes(cursor, 15) // 15-minute step
  }
}
```

---

## Step 5: Create the Reservation

Use a Server Action. Hooks auto-handle endTime, conflicts, and status validation:

```ts
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'

export async function createReservation(data: {
  service: string
  resource: string
  customerName: string
  customerEmail: string
  startTime: string
  notes?: string
}) {
  const payload = await getPayload({ config })

  // Find or create the customer
  const existing = await payload.find({
    collection: 'users',
    overrideAccess: false,
    where: { email: { equals: data.customerEmail } },
  })

  let customerId: string
  if (existing.docs.length > 0) {
    customerId = String(existing.docs[0].id)
  } else {
    const customer = await payload.create({
      collection: 'users',
      overrideAccess: false,
      data: {
        name: data.customerName,
        email: data.customerEmail,
        password: generateSecurePassword(),
      },
    })
    customerId = String(customer.id)
  }

  // Create reservation — hooks handle endTime + conflict checks
  const reservation = await payload.create({
    collection: 'reservations',
    overrideAccess: false,
    data: {
      service: data.service,
      resource: data.resource,
      customer: customerId,
      startTime: data.startTime,
      notes: data.notes,
      // status defaults to 'pending'
    },
  })

  return reservation
}
```

If the slot is already booked, `validateConflicts` throws a `ValidationError` — catch it in your UI.

---

## Security Notes

- **Always pass `overrideAccess: false`** — without it, Payload skips access control entirely
- Validate and sanitize all user input before passing to `payload.create`
- Consider rate limiting on Server Actions or API routes
- Hooks enforce conflict detection server-side, preventing double-bookings even with stale frontend data

---

## Alternative: REST API

For client-side-only approaches (e.g., separate SPA), use Payload's auto-generated REST API:

```ts
// Fetch services
const res = await fetch('/api/services?where[active][equals]=true')
const { docs: services } = await res.json()

// Create a reservation
const res = await fetch('/api/reservations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service: serviceId,
    resource: resourceId,
    customer: userId,
    startTime: '2025-03-15T10:00:00.000Z',
  }),
})
```

The same hooks and access control rules apply to REST API requests.

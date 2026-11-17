# Frontend SDK

`payload-reserve/sdk` is a small typed client for the public booking endpoints. It does not import Payload or React, so it runs in the browser, in a server component, or in a mobile app — anywhere `fetch` exists.

```ts
import { createReserveClient, ReserveError } from 'payload-reserve/sdk'

const reserve = createReserveClient({
  baseURL: 'https://example.com', // omit when the frontend and Payload share an origin
})

// 1. Show the free slots
const { slots, reason } = await reserve.getSlots({
  date: '2026-06-01', // a day in the business timezone
  resource: resourceId,
  service: serviceId,
})

// 2. Optional: hold the slot while the customer pays (needs the `slotHolds` option)
const { token } = await reserve.hold({
  resource: resourceId,
  service: serviceId,
  startTime: slots[0].start,
})

// 3. Book it
try {
  const reservation = await reserve.book({
    guest: { name: 'Jane Doe', email: 'jane@example.com' },
    holdToken: token,
    idempotencyKey: crypto.randomUUID(),
    resource: resourceId,
    service: serviceId,
    startTime: slots[0].start,
  })
} catch (err) {
  if (err instanceof ReserveError) {
    if (err.retryable) {
      // two people clicked at once — send the same request again
    } else {
      showError(err.message) // the booking rule's own sentence
    }
  }
}
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `baseURL` | same origin | Origin of the Payload app |
| `apiRoute` | `/api` | Payload's API route, if you changed `routes.api` |
| `credentials` | `'include'` | So a signed-in customer's cookie is sent |
| `headers` | — | Extra headers on every request, e.g. `Authorization: JWT <token>` |
| `fetch` | global `fetch` | A custom implementation (tests, older runtimes) |

## Methods

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getSlots({ resource, service, date, guestCount?, resources? })` | `GET /reserve/slots` | `{ date, guestCount, slots: [{ start, end }], reason? }` — `reason` says why `slots` is empty |
| `hold({ resource, service, startTime, endTime?, guestCount? })` | `POST /reserve/hold` | `{ token, expiresAt }` |
| `releaseHold(token)` | `POST /reserve/hold/release` | `{ released }` — safe to call twice |
| `book({ resource, service, startTime, ... })` | `POST /reserve/book` | the reservation (relationships as ids) |
| `cancel({ reservationId, token?, reason? })` | `POST /reserve/cancel` | the cancelled reservation |

Dates may be `Date` objects or ISO strings. For `getSlots`, pass `date` as a `YYYY-MM-DD` string: a `Date` is reduced to its UTC calendar day, which is not always the day your customer picked.

## Errors

Every non-2xx response throws a `ReserveError`:

| Property | Meaning |
|----------|---------|
| `status` | The HTTP status |
| `message` | A sentence you can show the user. For a booking rule it is the rule's own text ("This time slot is already booked"), not Payload's generic wrapper |
| `code` | A machine-readable code when the endpoint sends one — for holds: `slot_taken`, `service_inactive`, `outside_schedule`, `service_not_offered`, `invalid_window`, `hold_limit_reached`, `authentication_required`, `service_not_found`, `resource_not_found` |
| `detail` | Extra explanation that accompanies `invalid_window` and `hold_limit_reached` |
| `path` | The field a validation error points at, e.g. `startTime` or `items.1.resource` |
| `retryable` | `true` when the request lost a race with another booker and can be sent again unchanged |
| `body` | The raw parsed response |

---

↑ [Back to README](../README.md)

---
'payload-reserve': minor
---

Add guest (account-less) bookings. New `allowGuestBooking` plugin option (default `false`) and a per-service tri-state override (`inherit`/`enabled`/`disabled`). Reservations may now carry inline `guest` contact details (name + email/phone) instead of a `customer`; the `customer` field is now optional. Guest bookings receive a `cancellationToken` exposed via the `afterBookingCreate` hook so the host project can deliver an email link or SMS code; `/api/reserve/cancel` accepts `{ reservationId, token }` for unauthenticated guests. The plugin performs no email/SMS delivery itself.

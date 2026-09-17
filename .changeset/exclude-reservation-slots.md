---
"payload-reserve": minor
---

`getAvailableSlots` accepts `excludeReservationId`, the read-path counterpart of the option
`checkAvailability` has always taken. A reschedule that asks "which starts are on offer?"
no longer counts the booking being moved as occupancy, so a move shorter than the service
duration (09:00–11:00 → 10:00) can be offered. Other reservations keep blocking.

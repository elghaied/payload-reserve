---
'payload-reserve': minor
---

Availability-aware calendar & booking. The reservation `startTime` field is now a slot picker that only offers free times for the chosen service + staff (multi-resource + time-off aware). The admin calendar's week/day views shade off-shift, time-off, and fully-booked slots when a resource is selected, show capacity (`n/quantity`), render time-off bands, and support click-to-book (clicking a free slot opens the booking drawer pre-filled with that resource + time). Adds a resource-lane horizontal-timeline day view and multi-resource event badges. Backed by a new read-only `/api/reserve/resource-availability` endpoint and a pure, tested `computeSlotStates` utility.

All additive: with no resource filter selected the grid behaves as before, and the time field falls back to a plain date-time picker until a service and staff are chosen.

**Postgres:** no migration (read-only endpoint + UI only).

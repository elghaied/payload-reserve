---
'payload-reserve': patch
---

**Fixed: a `flexible`-duration booking could be stored with a NULL `endTime`, which made it invisible to conflict detection and allowed the same slot to be sold repeatedly.**

`calculateEndTime` branches on how many real `items[]` a reservation has, and the two branches disagreed about what a `flexible` service with no caller-supplied `endTime` meant. The single-resource branch rejected it (`endTime is required for flexible duration services`). The multi-resource branch skipped the item, which left the top-level span underived and stored the row with a NULL `endTime`.

That mattered because `endTime` is what every safety check is built on. `buildCoarseOverlapQuery` filters on `endTime greater_than`, so a NULL-`endTime` row was never fetched for any other booking's conflict check; `itemsToOccupancies` skips an item without an end, so it contributed no occupancy; and `validateConflicts` skipped such an item too, so the offending booking was itself checked against nothing. The slot could then be booked repeatedly, with no error raised on any attempt.

It did not require a multi-resource booking to reach. `expandRequiredResources` expands a service's `requiredResources` into `items[]`, so a service that is **both** `flexible` **and** carries any `requiredResources` took the multi-resource branch on an ordinary single-resource create — one caller, one resource, no multi-resource API involved.

Changes:

- `calculateEndTime` — a `flexible` item with no `endTime` of its own now inherits the top-level `endTime` (the same backfill `resolveReservationItems` performs) and is materialised onto the stored item. When no end can be inherited it raises the same `ValidationError`, with the same message and path, as the single-resource branch has always raised. An item whose window inverts against its own start is rejected, which the multi-resource branch never checked.
- `calculateEndTime` — a single chokepoint before the hook returns now refuses any reservation whose window could not be bounded, covering both branches and any future skip.
- `validateConflicts` — an item with no `endTime` is refused rather than skipped. A booking that cannot be bounded cannot be checked, and silently checking nothing was the worst available response. After the chokepoint above this is unreachable through the collection's own hook chain; it remains reachable for a host that reorders or replaces hooks via `collectionOverrides.reservations`.

**Behaviour change:** a `flexible` service booked with no `endTime` is now rejected on every path, where a service with `requiredResources` previously stored an unbounded reservation. Callers that relied on that must send an `endTime` — `startTime + service.duration` reproduces the window the availability API already advertises for flexible services, since `getAvailableSlots` sizes flexible slots by `service.duration`.

**Existing data is not repaired by this release.** Reservations already stored with a NULL `endTime` stay invisible to conflict detection, so their slots remain oversellable. They can be found with an `endTime exists: false` query on the reservations collection and repaired by setting an explicit `endTime`; no migration ships with this fix.

---
'payload-reserve': patch
---

Security and correctness fixes from an audit of 4.4.2.

**Security**

- **Guest cancellation after start.** A guest cancelling through `/api/reserve/cancel` with a token was treated like trusted host code and could cancel (and trigger `beforeBookingCancel`/`afterBookingCancel`, i.e. refunds) after the booking had started. The token path now gets the same rules as a signed-in customer.
- **`items[]` on public bookings is bounded.** New `maxPublicItems` (default 10) caps the array for public actors, and a booking whose `items[]` leave out the top-level resource may no longer span more than `maxFlexibleDuration` minutes. Two items a month apart used to block the top-level resource for that month.
- **The resource must offer the service.** New `enforceServiceMatch` (default `true`): for public actors and slot holds, a resource that lists `services` can only be booked with one of them (`409 service_not_offered` on holds). Resources with an empty list, required-resource pools, staff and userless Local API calls are unaffected. Set it to `false` to restore the old behaviour.
- **`create` access.** Under `resourceOwnerMode` with owners in a separate collection, customers can no longer create Resources, Schedules or owned Services. In standalone mode Customers `create` now defaults to staff only (a signed-in customer could create accounts for other addresses); `access.customers.create: () => true` still opens self-registration. `access.customers` is now composed per operation, so an `undefined` value no longer reopens the default.
- **`/api/reserve/cancel` ownership.** The owner check compares the collection as well as the id. On Postgres/SQLite a staff user whose numeric id matched the customer's was treated as the owner, skipping owner-mode and tenant access rules.

**Fixed**

- **Capacity is peak concurrency** (#9). The check summed every overlapping booking, so a `quantity: 2` resource with 10–11 and 11–12 booked rejected a 10–12 booking. It now counts the most units in use at any one instant.
- **Fail-closed reads** (#10). A failed service/resource read in `validateConflicts`, `expandRequiredResources` or `validateActive` now fails the booking instead of continuing with default buffers, without required pools, or as "active". A failing `getExternalBusy` is still ignored but is now logged at `warn`.
- **Slot endpoints load occupancy once per resource** (#11) instead of re-querying for every 15-minute candidate.
- **Input validation** (#12). `/api/reserve/hold/release` and `/api/reserve/cancel` answer `400` for non-string input (release returned a 500), tokens are compared in constant time, and a signed-in user holding a guest cancellation token can use it.

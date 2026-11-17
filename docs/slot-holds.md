# Slot Holds

Short-lived claims on a slot, taken while a customer completes an external step (typically payment) before the booking itself exists. Enable with the `slotHolds` plugin option:

```typescript
payloadReserve({
  slotHolds: {
    enabled: true,
    ttlMinutes: 10, // default; how long an unconverted hold blocks its slot
    requireAuth: false, // default; true refuses anonymous callers with 401
    maxActivePerCustomer: 5, // default; unexpired holds one signed-in customer may hold (false = no cap)
  },
})
```

Disabled by default — when absent, no `reservation-holds` collection is created, none of the endpoints below is registered, and availability behaviour is byte-identical to a plugin build without this feature at all. A hold occupies its resource exactly like a blocking reservation (folded into the same availability/conflict calculations); it carries no status, buffer, or `items[]` — one resource, one window, one clock. Expired holds are never trusted and are swept opportunistically, so no background job is required.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/reserve/hold` | `{ resource, service, startTime, endTime?, guestCount? }` | `201 { token, expiresAt }`; `409 { error: 'slot_taken' \| 'service_inactive' \| 'outside_schedule' \| 'service_not_offered' }` when the slot genuinely isn't available; `409 { error, retryable: true }` when lock contention outlived the retry budget; `404 { error: 'service_not_found' \| 'resource_not_found' }`; `400 { error: 'invalid_window', detail }` for a start in the past or a `flexible` window outside `[duration, maxFlexibleDuration]`; `400` for a missing or unparseable field; `401 { error: 'authentication_required' }` for an anonymous caller when `slotHolds.requireAuth` is on; `429 { error: 'hold_limit_reached', detail }` when a signed-in customer already has `slotHolds.maxActivePerCustomer` unexpired holds |
| POST | `/api/reserve/hold/release` | `{ token }` | `200 { released: 0 \| 1 }` — `200` even for an already-released or expired token (idempotent); `400 { error: 'token is required' }` for a missing or non-string token, `400 { error: 'Invalid JSON body' }` for an unparseable body |

Pass the token straight through to `POST /api/reserve/book` as `holdToken` to convert a hold into a real booking — the hold is excluded from that request's own conflict check (so it doesn't block the very booking it was protecting) and the hold row is deleted on success, best-effort, so a delete failure never fails the booking itself.

**The hold token is a bearer secret, and the collection is closed to the REST API entirely** — `create`, `read`, `update` and `delete` all return `false`, so `GET /api/reservation-holds` is denied for every caller including admins. Anyone who can read a live token can release someone else's hold or book their slot with it, and `admin: { hidden: true }` hides only the nav link, not the route. The plugin's own reads and writes reach the collection through the Local API privileged, so nothing internal depends on those rules. **Under `multiTenant`, list the holds slug in the multi-tenant plugin's own `collections` option** alongside the scheduling collections — the boot diagnostic warns if you don't.

**Anonymous holds must be rate-limited at your edge (4.1.3).** A hold is free to take and needs no login by default, so a script could hold every future slot of a resource and re-hold each one as it lapsed, keeping the schedule unbookable for as long as it ran — no data exposed, self-healing the moment it stops, but a real availability hole (reported privately by an external researcher against 4.1.1). The plugin gives you two knobs and is honest about the third: `slotHolds.maxActivePerCustomer` (default 5) caps what one signed-in customer can hold at once; `slotHolds.requireAuth` closes the endpoint to anonymous callers entirely, at the cost of the pre-account checkout flow holds were built for; and **per-IP throttling is your proxy's or middleware's job** — a Payload handler sees no trustworthy client address, so the plugin does not pretend to. If you keep anonymous holds, put a rate limit on `POST /api/reserve/hold` before you go live.

**Held slots are excluded from availability, not just from bookings.** `/api/reserve/availability`, `/api/reserve/slots` and `/api/reserve/resource-availability` all treat an unexpired hold as busy, so every customer-facing path agrees with the write path — a customer is never shown a slot the booking endpoint will then refuse with a `409`. That covers the reservation form's slot picker (`AvailabilityTimeField`, which fetches `/reserve/slots`) and the admin **Calendar** view (which fetches `/reserve/resource-availability`). Nothing in that path changes when `slotHolds` is off.

**The admin Availability grid shows holds too.** `AvailabilityOverview` (the weekly grid at `/reservation-availability`) marks a held slot as "Held" (dashed amber) on a single-unit resource and counts it in the "X / Y booked" badge on a multi-unit one. It reads them from `GET /api/reserve/held?resources=<ids>&start=<iso>&end=<iso>` — staff only, limited to resources the caller may read, and it returns `{ holds: [{ resource, startTime, endTime, expiresAt }] }` with no token.

---

↑ [Back to README](../README.md)

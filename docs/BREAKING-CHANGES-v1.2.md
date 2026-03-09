# v1.2.0 — Release Notes

This release fixes security vulnerabilities, data integrity issues, and correctness bugs across the plugin.

---

## Breaking changes

These changes **will break existing behavior** and may require code updates before upgrading.

### Cancel endpoint now enforces ownership

Any authenticated user could previously cancel any reservation via `POST /api/reserve/cancel`. Now only the reservation's customer or an admin/staff user can cancel — non-owners receive `403 Forbidden`.

**Update required if:** You have backend code that cancels reservations on behalf of other users (e.g., a support dashboard hitting the HTTP endpoint). Ensure those requests use an admin user, or use the Payload Local API with `context.skipReservationHooks`.

### Customer search restricted to admin/staff

`GET /api/reserve/customers` now returns `403 Forbidden` for customer-collection users.

**Update required if:** Your customer-facing frontend calls this endpoint directly. Proxy it through a server-side route with admin credentials, or build a custom endpoint.

### `beforeBookingConfirm` / `beforeBookingCancel` hooks receive merged doc

These hooks previously received only `originalDoc` (the pre-update document). They now receive `{ ...originalDoc, ...data }` — the document merged with incoming changes, so fields like `status` reflect the **new** value.

**Update required if:** Your hook implementations read fields from the doc and expect pre-update values. `previousStatus` is still passed separately to `beforeBookingConfirm`. For `beforeBookingCancel`, `reason` remains a separate parameter.

### After-status-change hooks no longer throw

Errors in `afterStatusChange`, `afterBookingConfirm`, and `afterBookingCancel` hooks are now caught and logged via `req.payload.logger.error` instead of propagating up.

**Update required if:** You relied on after-hook errors causing the API response to fail (e.g., to detect notification failures). Move critical logic to `beforeBookingConfirm`/`beforeBookingCancel` if it must fail atomically with the status change.

### Conflict error paths changed for multi-resource bookings

Conflict detection errors now use `items.N.startTime` instead of `startTime` when the reservation has multiple items.

**Update required if:** Your client-side code parses error paths from conflict `ValidationError` responses.

### Incomplete multi-resource items now throw instead of being silently dropped

Items missing `resource` or `startTime` previously got silently filtered out. They now throw a `ValidationError` identifying the incomplete item (e.g., `items.1.resource`).

**Update required if:** You programmatically create multi-resource bookings and rely on silent filtering of optional/incomplete items. Clean up item arrays before submission.

### Slot generation returns more slots

Step size changed from service-duration-aligned (e.g., every 60 min) to `Math.min(serviceDuration, 15)` minutes. A 60-min service now generates candidates at 9:00, 9:15, 9:30, etc.

**Update required if:** You assert on the exact number of returned slots in tests, or your UI assumes a specific slot count.

---

## Improvements (non-breaking)

These changes fix bugs or add validation but shouldn't require code changes for existing integrations.

### Admin detection fix

The `isAdmin` check previously compared against a hardcoded `'users'` string, which failed for non-default admin collection slugs. It now correctly identifies admin as any user whose collection is not the customers collection. If you use the default `'users'` admin collection, nothing changes.

### guestCount now affects slot availability

`GET /api/reserve/slots` previously ignored the `guestCount` query parameter. It's now passed through to `checkAvailability`, so `per-guest` capacity mode resources correctly filter slots. If you don't use `per-guest` capacity mode, nothing changes.

### Full-day services return proper slots

Full-day services (`durationType: 'full-day'`) now return one slot per schedule range covering the entire day, instead of going through the time-slicing loop which could return no slots or incorrectly sized ones.

### Invalid dates return 400

`GET /api/reserve/availability` now returns `400 Bad Request` for unparseable date values instead of proceeding with an invalid Date object.

### Schedule time format validation

Schedule `startTime`/`endTime` fields now validate `HH:mm` format (e.g., `09:00`, `17:30`) and enforce `endTime > startTime`. Existing valid schedules are unaffected — this only triggers on create/edit.

### Duplicate resource+time detection

Submitting multiple items with the same `(resource, startTime)` pair in a single booking now throws a `ValidationError`. This catches what was almost certainly a bug in calling code.

### Status machine config validation

`resolveConfig()` now validates the status machine at init time — checking that `defaultStatus`, `blockingStatuses`, `terminalStatuses`, and all transition keys/targets reference valid statuses. If your app starts today, this won't affect you.

### Per-item buffer time resolution

`validateConflicts` now fetches each item's own service for buffer times instead of using the parent service uniformly. Conflict detection is more accurate for multi-resource bookings with mixed services.

---

## Migration checklist

- [ ] Review code calling `POST /api/reserve/cancel` — must be owner or admin
- [ ] Review customer-facing code calling `GET /api/reserve/customers` — now admin-only
- [ ] Check `beforeBookingConfirm`/`beforeBookingCancel` hooks — doc now has new values merged in
- [ ] Check `afterStatusChange`/`afterBookingConfirm`/`afterBookingCancel` hooks — errors are logged, not thrown
- [ ] Update client-side error path matching for conflict errors (`items.N.startTime`)
- [ ] Clean up multi-resource booking code — no more silent filtering of incomplete items
- [ ] Update slot count assertions in tests if any

# Breaking Changes — v1.2.0

This release fixes security vulnerabilities, data integrity issues, and correctness bugs. Several changes alter existing behavior and may require updates to your code.

---

## Security (action required if affected)

### Cancel endpoint now enforces ownership

**Previously:** Any authenticated user could cancel any reservation via `POST /api/reserve/cancel`.

**Now:** Only the reservation's customer or an admin/staff user can cancel. Non-owners receive a `403 Forbidden`.

**Action:** If you have backend code that cancels reservations on behalf of other users (e.g., a support dashboard hitting the HTTP endpoint), ensure those requests use an admin user. Alternatively, use the Payload Local API with `context.skipReservationHooks` to bypass the check.

### Customer search restricted to admin/staff

**Previously:** Any authenticated user (including customers) could call `GET /api/reserve/customers`.

**Now:** Customer-collection users receive `403 Forbidden`. Only admin/staff users can search customers.

**Action:** If your customer-facing frontend uses this endpoint (e.g., for autocomplete), you'll need to proxy it through a server-side route that uses an admin credential, or build a custom endpoint.

### Confirmed-on-create restricted to admin users

**Previously:** The `isAdmin` check compared `req.user?.collection` against a hardcoded `'users'` string, which failed if your admin collection had a different slug.

**Now:** Admin is defined as any authenticated user whose collection is **not** the customers collection (`req.user.collection !== config.slugs.customers`). This correctly identifies admin users regardless of your admin collection's slug.

**Action:** If you relied on customer users being able to create reservations with non-default statuses (due to the broken check), this is no longer possible. Use `context.allowConfirmedOnCreate` as an escape hatch for programmatic creation.

---

## Behavior changes

### Slot generation returns more slots (smaller step size)

**Previously:** Slot candidates were generated at intervals equal to the service duration (e.g., every 60 minutes for a 60-min service).

**Now:** Step size is `Math.min(serviceDuration, 15)` minutes, so a 60-min service generates candidates every 15 minutes (9:00, 9:15, 9:30, ...).

**Action:** If you assert on the number of returned slots (e.g., in tests), update your expectations. If you display slots in a UI, you'll now see more options. The slots are still correctly filtered by availability — only the candidate generation changed.

### guestCount now affects slot availability

**Previously:** `GET /api/reserve/slots` ignored the `guestCount` query parameter — all slots were checked assuming 1 guest.

**Now:** `guestCount` is passed through to `checkAvailability`, so resources using `per-guest` capacity mode will correctly exclude slots that lack sufficient guest capacity.

**Action:** If you have resources with `capacityMode: 'per-guest'`, you may see fewer available slots when requesting for groups. This is the correct behavior.

### Full-day services return single slots per schedule range

**Previously:** Full-day services went through the time-slicing loop, potentially returning no slots or incorrectly sized slots.

**Now:** Full-day services (`durationType: 'full-day'`) return one slot per schedule range covering the entire day.

**Action:** If you have full-day services, verify the returned slots match your expectations.

### Invalid dates return 400 instead of silently failing

**Previously:** `GET /api/reserve/availability?date=not-a-date` would proceed with an invalid Date object, returning unpredictable results.

**Now:** Returns `400 Bad Request` with `{ message: 'Invalid date format' }`.

**Action:** Ensure your frontend sends valid ISO date strings.

---

## Hook behavior changes

### `beforeBookingConfirm` / `beforeBookingCancel` receive merged doc

**Previously:** These hooks received only `originalDoc` (the pre-update document).

**Now:** They receive `{ ...originalDoc, ...data }` — the document merged with incoming changes.

**Action:** If your hooks inspect the doc for the current status or other changing fields, they now see the **new** values. If you need the previous values, note that `previousStatus` is still passed separately to `beforeBookingConfirm`. For `beforeBookingCancel`, the `reason` field is passed as a separate parameter.

### After-status-change hooks no longer throw

**Previously:** If `afterStatusChange`, `afterBookingConfirm`, or `afterBookingCancel` hooks threw an error, the exception propagated up and could fail the entire request (even though the DB write already succeeded).

**Now:** Errors in after-hooks are caught and logged via `req.payload.logger.error`. The response still succeeds.

**Action:** If you relied on after-hook errors causing the API response to fail (e.g., to signal a notification failure), you'll need to handle errors differently. Consider using `beforeBookingConfirm`/`beforeBookingCancel` for operations that must succeed or fail atomically with the status change.

---

## Validation changes (may reject previously accepted data)

### Schedule time fields validate HH:mm format

**Previously:** Schedule `startTime`/`endTime` text fields accepted any string.

**Now:** Must match `HH:mm` format (e.g., `09:00`, `17:30`). Additionally, `endTime` must be after `startTime` within each slot.

**Action:** If you have existing schedules with non-standard time formats (e.g., `9:00` without leading zero, or `09:00:00` with seconds), they'll fail validation on next edit. Fix them in the database or update via script before upgrading.

### Incomplete multi-resource items now throw instead of being silently dropped

**Previously:** Items in a multi-resource booking that were missing `resource` or `startTime` were silently filtered out.

**Now:** A `ValidationError` is thrown identifying which item is incomplete (e.g., `items.1.resource`).

**Action:** If you programmatically create multi-resource bookings and relied on silent filtering (e.g., passing optional items), you must now either omit incomplete items before submission or ensure all items have `resource` and `startTime`.

### Duplicate resource+time pairs in multi-resource bookings are rejected

**Previously:** You could submit multiple items targeting the same resource at the same startTime within one booking.

**Now:** Duplicate `(resource, startTime)` pairs throw a `ValidationError`.

**Action:** If you have code that builds item arrays, ensure no duplicates. This was almost certainly a bug in calling code, not intentional behavior.

### Invalid status machine configs fail at init time

**Previously:** A misconfigured `statusMachine` (e.g., `defaultStatus` not in `statuses`, or transition targets referencing non-existent statuses) was accepted silently and could cause runtime errors.

**Now:** `resolveConfig()` validates the status machine and throws at plugin initialization if the config is invalid.

**Action:** If your app starts successfully today, this won't affect you — it only catches configs that were already broken. If it does throw on startup, fix the status machine config.

---

## Per-item buffer time resolution

**Previously:** `validateConflicts` used the parent reservation's service to determine buffer times, applying the same `bufferBefore`/`bufferAfter` to all items.

**Now:** Each item's own service is fetched to determine its specific buffer times. Conflict errors also include the item index (e.g., `items.2.startTime`) for multi-resource bookings.

**Action:** If you have multi-resource bookings where different items reference services with different buffer times, conflict detection is now more accurate. Error message paths changed from `startTime` to `items.N.startTime` for multi-resource bookings — update any client-side error handling that matches on the path.

---

## Migration checklist

- [ ] Review any code calling `POST /api/reserve/cancel` — ensure it uses the reservation owner or admin credentials
- [ ] Review any customer-facing code calling `GET /api/reserve/customers` — move to server-side proxy if needed
- [ ] Check `beforeBookingConfirm`/`beforeBookingCancel` hook implementations for doc field assumptions
- [ ] Check `afterStatusChange`/`afterBookingConfirm`/`afterBookingCancel` hooks — errors are now swallowed (logged only)
- [ ] Update slot count assertions in tests
- [ ] Verify existing schedule data uses `HH:mm` format
- [ ] Review multi-resource booking creation code for incomplete items or duplicates
- [ ] Verify `statusMachine` config if using custom status workflows
- [ ] Update client-side error handling for new conflict error paths (`items.N.startTime`)

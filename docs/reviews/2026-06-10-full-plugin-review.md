# Full Plugin Review — 2026-06-10

Five-domain review (hooks, availability math, endpoints, wiring/collections, admin UI).
All Critical/High findings were independently verified against the source. Findings are
deduplicated across domains and ordered by severity within each section.

---

## A. Booking integrity (core correctness)

### A1. ~~CRITICAL — Partial updates bypass conflict validation~~ — RE-DIAGNOSED & FIXED (branch `fix/partial-update-conflict-bypass`)
`src/hooks/reservations/validateConflicts.ts`, `src/hooks/reservations/calculateEndTime.ts`

**Original claim disproven empirically (2026-06-10).** Payload's `beforeValidate` field
hooks backfill every field absent from an update patch out of `originalDoc`
(`payload/dist/fields/hooks/beforeValidate/getFallbackValue.js`) before collection
`beforeChange` hooks run — so `data` arrives full on update and conflict validation
already fired. The pre-fix test matrix confirmed it: moving onto an occupied slot and
guestCount-over-capacity were already rejected.

**The real pre-fix bugs (both fixed):**
1. Because every update re-validated, benign edits (notes-only, status-only) were
   **spuriously blocked** whenever service buffers/schedules changed after booking.
   Fixed: both hooks now skip updates that change no scheduling-relevant field
   (`schedulingFieldsChanged`, value-based comparison) and otherwise validate an
   explicitly merged doc (`mergeReservationData`) instead of relying on the backfill.
2. Flexible-duration reservations could be rescheduled past their stored `endTime`,
   silently persisting an **inverted window** invisible to overlap queries (part of A10).
   Fixed: `endTime <= startTime` now rejected on create and update.

### A2. CRITICAL — Mixed UTC/local day semantics resolve the wrong calendar day on non-UTC servers
`src/utilities/scheduleUtils.ts:16-21,41-46,52-62,113-115`, `src/endpoints/getSlots.ts:23`, `src/endpoints/checkAvailability.ts:25`

Endpoints parse `date=YYYY-MM-DD` via `new Date(date)` → **UTC midnight**. Then
`getDayOfWeek()` uses **local** `getDay()`, `combineDateAndTime()` uses **local**
`setHours()`, but `isExceptionDate()` and manual-slot matching key on the **UTC** date via
`toISOString()`. On a server west of UTC, `?date=2026-06-10` (Wed) resolves to *Tuesday's*
recurring slots and generates slot times on June 9 local. Exceptions can block the wrong
day. Invisible on UTC servers (why tests pass) — a deployment landmine.

Related inconsistencies:
- `src/endpoints/resourceAvailability.ts:102-121` uses **local** day keys/midnight while
  `getAvailableSlots` uses UTC keys → admin grid and booking API disagree about which day
  an exception blocks.
- Full-day `computeEndTime` (`src/services/AvailabilityService.ts:18-23`) uses server-local
  `setHours(23,59,59,999)`.
- `Resource.timezone` (`src/collections/Resources.ts:140-147`) is a **dead field** — defined,
  never read anywhere.

**Fix direction:** pick one day-resolution convention (UTC everywhere, or resource
timezone), apply it across scheduleUtils, AvailabilityService, resourceAvailability, and
document it. Wire up or remove `Resource.timezone`.

### A3. HIGH — Existing reservations' buffer times are not enforced
`src/services/AvailabilityService.ts:37-64,139-153`

`checkAvailability` expands only the **candidate's** window (`computeBlockedWindow`) and
compares against other reservations' unbuffered stored `[startTime, endTime)`. Example:
existing booking 10:00–11:00 for a service with `bufferTimeAfter: 30`; a candidate at
11:00 passes, violating the 30-min cleanup. Works only when overlapping services happen to
have `bufferBefore == bufferAfter`. `getAvailableSlots` offers the violating slots too.

**Fix direction:** either store buffered windows (blockedStart/blockedEnd) on the doc, or
expand each fetched conflict by its own service's buffers before comparing.

### A4. HIGH — Multi-item reservations falsely block every resource for the whole span
`src/services/AvailabilityService.ts:47-57`, `src/hooks/reservations/calculateEndTime.ts:57-108`

`buildOverlapQuery` matches `items.resource` but compares only **top-level**
`startTime`/`endTime`, which is deliberately set to the earliest-start/latest-end span of
all items. A spa package `[room A 09:00–10:00, sauna 14:00–15:00]` blocks room A for
09:00–15:00. Per-guest capacity also sums the **top-level** `guestCount` regardless of the
matched item's own count (`AvailabilityService.ts:163-169`).

### A5. HIGH — Sibling items in one reservation are not conflict-checked against each other
`src/utilities/resolveReservationItems.ts:56-67`, `src/services/AvailabilityService.ts:147-192`

Duplicate detection rejects only exact `(resource, startTime)` pairs; `checkAvailability`
sees only persisted reservations. `items: [{A, 10:00}, {A, 10:30}]` with a 60-min service
double-books resource A inside a single create, even with `quantity: 1`.

### A6. HIGH — `beforeBookingCreate` plugin hooks fire **twice** for `/api/reserve/book`
`src/endpoints/createBooking.ts:12-16` + `src/collections/Reservations.ts:28-35`

The endpoint runs the hooks on the raw body, then `payload.create` triggers the
collection-level `createPluginHooksBeforeCreate`, which runs the same hooks again
(`operation === 'create'`, no suppression flag). A host hook that creates a Stripe
PaymentIntent runs twice per booking.

**Fix direction:** remove the endpoint-side invocation (collection hook covers all create
paths) or pass a context flag the collection hook respects.

### A7. HIGH — `onStatusChange` fires on every create with `previousStatus: undefined`
`src/hooks/reservations/onStatusChange.ts:9`

On create, Payload passes `previousDoc: {}` (not `undefined`), so the guard
`!previousDoc || previousDoc.status === doc.status` doesn't short-circuit. Every create
fires `afterStatusChange` (with `previousStatus: undefined` despite the `string` type),
and a `status: 'confirmed'` create also fires `afterBookingConfirm` — duplicating
`afterBookingCreate`-driven notifications.

**Fix direction:** guard on `operation === 'create'` or `!previousDoc?.status`.

### A8. MEDIUM — `beforeBookingCancel` side effects fire before `validateCancellation` can reject
`src/collections/Reservations.ts` (hook order), `validateStatusTransition.ts:80-88`

`validateStatusTransition` runs external `beforeBookingCancel` hooks (e.g. refund
initiation); `validateCancellation` runs **after** and may throw. A rejected late cancel
leaves the refund initiated but the reservation still `confirmed`.

### A9. MEDIUM — No staff/admin bypass for the cancellation notice period; post-start cancels are free
`src/hooks/reservations/validateCancellation.ts:29`

Unlike `validateStatusTransition`, this hook has no `isPrivilegedUser` bypass — staff
can't cancel inside the notice window via admin UI without `skipReservationHooks` (which
also disables conflict checks and after-hooks). And `hours > 0` means once start time
passes, anyone can cancel freely (dodging no-show).

### A10. MEDIUM — Flexible-duration `endTime` is never validated
`src/hooks/reservations/calculateEndTime.ts:41-47`, `src/services/AvailabilityService.ts:25-30`

A flexible booking with `endTime < startTime` is accepted (comment claims computeEndTime
validates; it doesn't). The inverted window matches no overlap query, so it neither fails
nor blocks the resource. No max-duration cap either. Also: in multi-item creates, a
flexible item without `endTime` skips conflict checking entirely
(`calculateEndTime.ts:82` + `validateConflicts.ts:22` both `continue`).

### A11. MEDIUM — Exceptions only blank their own schedule, not the resource
`src/services/AvailabilityService.ts:251-276`, `src/utilities/scheduleUtils.ts:92-96`

CLAUDE.md says an exception makes the resource fully unavailable that day, but windows
from **all** active schedules are concatenated — a resource with a second schedule stays
bookable on a vacation day recorded in only one.

### A12. MEDIUM — Primary `resource` is unchecked when `items[]` is supplied
`src/utilities/resolveReservationItems.ts:25-79`

With `items[]` populated, the top-level `resource` is never availability-checked, yet it
still blocks others via the overlap query's `resource equals` branch.

### A13. LOW — `expandRequiredResources` is create-only and silently swallows fetch errors
`src/hooks/reservations/expandRequiredResources.ts:17,34`

Changing a reservation's service on update never re-expands `requiredResources`; a
transient DB error during the service fetch silently skips expansion (no logging).

### A14. LOW — Idempotency: TOCTOU race + globally scoped key
`src/hooks/reservations/checkIdempotency.ts:14-24`, `Reservations.ts:247-252`

Count-then-create races; the unique sparse index saves data integrity but the loser gets
a raw duplicate-key 500, after side effects of earlier hooks already ran. The key is
global, not per-customer: two customers reusing `"booking-2026-06-12"` collide.

### A15. LOW — `createPluginHooksAfterCreate` ignores `context.skipReservationHooks`
`src/collections/Reservations.ts:44-52`

Seeds/migrations using the escape hatch still fire `afterBookingCreate` (emails) per
imported reservation.

### A16. LOW — `excludeReservationId` falsy check skips id `0`
`src/services/AvailabilityService.ts:59` — numeric Postgres id `0` would conflict with itself on update.

---

## B. Security

### B1. HIGH — `/api/reserve/resource-availability` is unauthenticated and bypasses all access control
`src/endpoints/resourceAvailability.ts:197-227,26-53`

No `req.user` check; internal queries call the Local API **without `req`** (default
`overrideAccess: true`), bypassing `resourceOwnerMode` and tenant scoping. Anonymous
callers can enumerate resource IDs and download every resource's full busy calendar
(`busy[]: { start, end, units }`). Also undocumented (CLAUDE.md lists 5 endpoints; 6 are registered).

### B2. HIGH — Unbounded date range in resource-availability → CPU DoS
`src/endpoints/resourceAvailability.ts:102,210-214`

`start`/`end` validated only for NaN; `start=2000-01-01&end=3000-01-01` → ~365k day
iterations with per-resource queries, from an unauthenticated request. Cap the span
(e.g. 90 days).

### B3. HIGH — `createBooking` mass assignment: book as any customer, set your own cancellationToken
`src/endpoints/createBooking.ts:8-25`, `validateGuestBooking.ts:106`

The raw body goes straight to `payload.create` (overrideAccess default). Anonymous callers
can set `customer: <any-user-id>` (spoofed bookings for arbitrary victims) and supply
their own `cancellationToken` (only generated when absent). Status escalation IS blocked
(validateStatusTransition checks the user, good); `context` injection is NOT possible (good).

**Fix direction:** allow-list body fields; force `customer = req.user.id` when
authenticated; reject caller-supplied `cancellationToken`.

### B4. MEDIUM — Two divergent admin-detection mechanisms; single-collection mode misclassifies
- `isPrivilegedUser` (`src/utilities/userRoles.ts:27-35`): in `userCollection` mode with no
  `adminRoles`/`staffRoles` configured, **every user including admins** is treated as a
  customer (fail-safe denial, but breaks customerSearch/cancelBooking for real admins).
  Document the hard requirement or validate at init.
- Raw `req.user.collection !== slugs.customers` still used at
  `validateGuestBooking.ts:75` and `Reservations.ts:137-139` (cancellationToken read
  access — in single-collection mode **nobody** can read the token). Unify on
  `isPrivilegedUser`.
- `ownerAccess.isAdmin` (`src/utilities/ownerAccess.ts:15`) hardcodes `user.role`,
  ignoring `staffProvisioning.roleField` — apps with `roles: string[]` get admins demoted
  to owners and **Reservations become immutable** in the admin UI (create/update/delete
  are adminOnly under `makeReservationOwnerAccess`). Same lockout when
  `resourceOwnerMode.adminRoles` is empty/unset (`defaults.ts:122`).

### B5. LOW/UNCERTAIN — `customerSearch` regex injection / ReDoS via `contains`
`src/endpoints/customerSearch.ts:55-73` — raw search string into `contains`; on Mongo this
historically compiles to unescaped `$regex`. Staff-gated, so low. Verify adapter escaping.

### B6. LOW — NaN propagation from numeric query params
`customerSearch.ts:39-40` (limit/page), `checkAvailability.ts:33`, `getSlots.ts:31`
(`guestCount=abc` → `Math.max(NaN,1)` = NaN → every slot filtered → empty 200 instead of 400).
Use `Number.isFinite` guards.

### B7. LOW — Non-constant-time cancellation-token compare
`src/endpoints/cancelBooking.ts:43` — use `crypto.timingSafeEqual` for defense-in-depth.

### B8. LOW — Unhandled `findByID` cast errors → 500
`checkAvailability.ts:40`, `getSlots.ts:38`, `resourceAvailability.ts:78` — malformed IDs
throw (Mongo ObjectId cast) → 500 instead of 400/404.

---

## C. Plugin wiring / config

### C1. HIGH — Services owner field hardcodes `relationTo: customers`, ignoring `ownerCollection`
`src/collections/Services.ts:31` vs `Resources.ts:39-40` (already fixed there with a
comment saying the customers hardcoding "broke separate users/customers setups").
With separate staff/customer collections + `ownedServices: true`, the Services owner
relationship points at the wrong collection.

### C2. HIGH — `userCollection` pointing at a nonexistent collection fails silently
`src/plugin.ts:42-91` — `find()` miss skips field injection with no error, but
`slugs.customers` is still repointed; reservations then relate to a dead slug. Contrast
`staffProvisioning`, which throws (`plugin.ts:126-130`). Throw here too.

### C3. MEDIUM/HIGH — `disabled: true` skips collection registration entirely
`src/plugin.ts:36-38` — Payload convention keeps collections registered when disabled so
the DB schema stays consistent; on Postgres this generates table-dropping migrations.
Also `resolveConfig` runs before the disabled check (`plugin.ts:25`), so a misconfigured
plugin still throws at boot even when disabled.

### C4. MEDIUM — userCollection field injection: shallow dedup + injected `required: true`
`src/plugin.ts:48-86` — dedup only scans top-level named fields (tabs/rows/collapsibles
not descended → duplicate data-path collisions); injected required `name` breaks updates
to existing docs that lack it.

### C5. MEDIUM — `provisionStaffResource` never backfills pre-existing staff
`src/hooks/users/provisionStaffResource.ts:41-50` — on update it early-returns when
`previousDoc` already had a staff role, **before** the dedup-by-owner query. Enabling the
plugin on an existing staff roster, or deleting a provisioned Resource, can never be
repaired except by flapping the role. Drop the early return; rely on the dedup query.

### C6. MEDIUM — `validateStatusMachine` gaps + unenforced `terminalStatuses`
`src/defaults.ts:10-34`, `src/services/AvailabilityService.ts:73-89` — `terminalStatuses`
is never consulted by `validateTransition` (only display components use it); statuses
missing a `transitions` key give a misleading "Unknown status" error; `defaultStatus` may
be terminal. Validate: terminal ⇒ no outgoing transitions; every status has a transitions
entry; defaultStatus not terminal.

### C7. MEDIUM — Hardcoded `'confirmed'`/`'cancelled'` literals break custom status machines
`validateStatusTransition.ts:69,80`, `onStatusChange.ts:24,33`, `validateCancellation.ts:21`,
`Reservations.ts:189` (cancellationReason condition) — renamed vocabularies silently
disable confirm/cancel plugin hooks and the notice-period rule. Make the confirm/cancel
status names configurable on the machine (e.g. `confirmStatus`, `cancelStatus`) or document.

### C8. MEDIUM — Plugin assumes a `media` collection exists
`Services.ts:61`, `Resources.ts:85` — upload fields relate to `slugs.media` with no check
or documentation; apps without it get an opaque init failure.

### C9. LOW — Access override replaces instead of composing
`Services.ts:37-39`, `Resources.ts:62-63`, `Schedules.ts:22-23`, `Reservations.ts:60-61` —
providing only `access: { resources: { read } }` silently discards ALL owner-mode rules
for that collection (create/update/delete fall back to any-authenticated). Customers
composes (`Customers.ts:11-14`); the rest don't. Merge per-operation.

### C10. LOW — Schedules time validation order + UTC day shift in exception compare
`src/collections/Schedules.ts:194-212` — lexicographic `'9:00' >= '10:00'` comparison runs
before format validation (misleading error); exception range compare via `toISOString()`.

### C11. LOW — Slug collisions produce Payload's generic DuplicateCollection error
`plugin.ts:94-108` — pre-check and throw with a hint to override `slugs.*`.

---

## D. Admin UI

### D1. HIGH — Month view renders 42 days but fetches fewer: trailing weeks always empty
`src/components/CalendarView/index.tsx:197-215` (fetch ends at the week containing the
month's last day) vs `:663-676` (fixed 42-cell grid). Most months leave 1–2 rendered weeks
outside the fetched range — admins see free days that are booked. Feb 2026 (starts Sunday)
misses two full weeks. **Fix:** fetch `start + 42 days`.

### D2. HIGH — Client/server day-key mismatch when server TZ ≠ browser TZ
Client `localDayKey` (browser TZ) at `CalendarView/index.tsx:754,807,896,955`,
`LaneTimelineView.tsx:45` vs server `localDayKey` (server TZ) at
`resourceAvailability.ts:102-104`. With a UTC server and UTC+2 browser, the last day of a
week range gets no availability shading; shift windows render shifted by the TZ offset.
Same root cause family as A2.

### D3. HIGH — AvailabilityOverview mixes UTC and local keys; exceptions/manual slots shift a day
`src/components/AvailabilityOverview/index.tsx:189` (`toISOString()` UTC key) vs `:190`
(local `getDay()`). In UTC+ browsers, recurring slots land on the right column while
exceptions and manual slots land one day off — in the same grid.

### D4. HIGH/MEDIUM — AvailabilityOverview ignores exception `endDate` ranges
`AvailabilityOverview/index.tsx:20-28,196-199` — a Jun 8–12 vacation shows as exception
on Jun 8 only; Jun 9–12 render available while the server rejects every booking.

### D5. MEDIUM — No abort/stale-response guards on any fetch
`useResourceAvailability.ts:21-40`, `CalendarView/index.tsx:225-243,250,270`,
`AvailabilityOverview/index.tsx:107-165`, `AvailabilityTimeField/index.tsx:50-70`,
`CustomerField/index.tsx:82-99` — rapid navigation/resource switching can leave stale data
rendered (classic race). Add AbortController or ignored-flag cleanup.

### D6. MEDIUM — CustomerField hardcodes `/api/` prefix
`CustomerField/index.tsx:62,87` — every other component uses
`config.serverURL + config.routes.api`. Custom `routes.api` deployments get silent 404s.

### D7. MEDIUM — DashboardWidgetServer: `limit: 100` truncation + server-TZ "today"
`DashboardWidgetServer.tsx:54-59,40-42,111` — >100 reservations/day undercounts stats and
can show "no upcoming appointment" falsely; day boundaries and displayed times use server TZ.

### D8. MEDIUM — Hardcoded, mutually inconsistent visible-hour windows
Week 7–18 (`CalendarView/index.tsx:744`), day 7–20 (`:887`), lanes 7–19
(`LaneTimelineView.tsx:15-16`) — a 20:00 booking is invisible in week view but visible in
day view; pre-07:00 bookings invisible everywhere but month view. No overflow indicator.

### D9. MEDIUM — `limit: 500` caps with no totalDocs check; pending badge fetches ALL docs
`CalendarView/index.tsx:231,274`, `AvailabilityOverview/index.tsx:127-132`,
`resourceAvailability.ts:45-52` (500-cap also hides busy intervals → grid shows free where
booked). Pending badge (`CalendarView/index.tsx:252-254`) uses `limit=0`, which in Payload
means **no limit** — downloads every pending doc on each refresh; use `limit=1&depth=0` +
`totalDocs`.

### D10. LOW — Pending badge shows 0 when a resource filter is active before visiting the tab
`CalendarView/index.tsx:1228-1231` vs `:287-291`.

### D11. LOW — Week fetch range over-fetches up to ~5 weeks at month boundaries
`CalendarView/index.tsx:206-209` — `end.setDate(start.getDate() + 6)` applied to the
unmodified clone of currentDate.

### D12. LOW — AvailabilityOverview booked counts disagree with server capacity semantics
`AvailabilityOverview/index.tsx:235-245,302-303` — items[] resources not counted;
per-guest mode counts reservations instead of summing guestCount.

### D13. LOW — AvailabilityTimeField doesn't exclude the reservation being edited
`AvailabilityTimeField/index.tsx:58-60` — editing a reservation, its own slot shows
unavailable.

---

## E. Verified non-issues (checked, fine)

- Overlap semantics are correctly half-open (`startA < endB && startB < endA`); back-to-back bookings allowed.
- Slot loop never emits slots past schedule close; DAY_MAP matches `getDay()`.
- Per-guest sum handles null guestCount (`?? 1`); `limit: 0` Local API queries return all docs (no undercount).
- `idempotencyKey` unique+sparse on Mongo (no null collisions); Postgres allows multiple NULLs.
- `context.skipReservationHooks` / `allowConfirmedOnCreate` cannot be injected via request body.
- Status escalation on create is blocked independent of overrideAccess.
- Components handle custom status machines well (palette colors, dynamic legend, i18n fallback).
- No XSS vectors (no dangerouslySetInnerHTML; React-escaped).
- Export paths clean ('use client' markers correct; no server code in client bundle).
- `provisionStaffResource` impersonation is sound; no infinite-loop risk; role string/array both handled.
- Empty `resourceTypes`/`leaveTypes` rejected at init.

## F. Worth a look (uncertain)

- `resolveReservationItems` dedupe key type-sensitivity (Date vs ISO string startTime).
- Impersonated `{ ...req, user }` spread loses Request prototype getters (headers/url) — fine today, fragile for downstream hooks.
- `readCookie` doesn't strip RFC-6265 quoted cookie values (`tenantFilter.ts:39-47`).
- multiTenant defaults are always armed (`defaults.ts:116-119`) — an app with an unrelated top-level `tenant` field gets admin-view scoping without opting in.
- DST: `resourceAvailability.ts:102` day loop steps 86,400,000 ms — duplicate/skewed day keys across fall-back transitions.
- `getAvailableSlots` N+1 queries per slot×resource (perf); never filters past slots.
- Full-day slots checked with buffers (0,0) while booking-side validation applies them.
- CLAUDE.md staleness: says 5 endpoints (6 registered); customer search path is `/api/reservation-customer-search`, not `/api/reserve/customers`.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [4.0.0] - 2026-08-21

A new reservation detail drawer, and a `components` plugin option for replacing any of six
admin components with your own, without forking the plugin. Both ship no collection schema
change and need no data migration. The one thing every consumer must do on upgrade — whether
or not any new feature is used — is regenerate the admin import map, because the Reservations
list view's default component path changed; skipping it silently drops back to Payload's plain
table with no UI explanation. A handful of smaller behavioural changes ride along and are
disclosed below.

### Breaking

- **Action required after upgrading, even if you never touch the new `components` option: run
  `payload generate:importmap`, then restart your app.**

  The Reservations list view's default component changed from `payload-reserve/client#CalendarView`
  to `payload-reserve/rsc#CalendarViewServer`. Payload resolves every admin component path through
  an import map generated **into your own app**, not this package, so an install that upgrades and
  restarts without regenerating it still has the _old_ key and is missing the _new_ one. The
  result is silent: a missing import-map key logs a `console.error` server-side and Payload's List
  view falls back to its default table — your admin sees a plain reservations table where the
  calendar used to be, with nothing in the UI explaining why.

- **Type-only: the package-root `Reservation` type is renamed to `CalendarReservation`.** It is a
  deliberately loose, UI-shaped structural type for the calendar/detail-drawer components —
  exported as plain `Reservation` it was too easy to mistake for your own generated `payload-types`
  `Reservation`, which is what most people would assume a bare `Reservation` import from this
  package to be. No runtime change; update `import type { Reservation } from 'payload-reserve'` to
  `CalendarReservation` if you use it. `ReservationItem` is unchanged.

- **Type-only: `CalendarView`'s exported prop type changed from `React.FC<AdminViewServerProps>`
  to `React.FC<CalendarViewProps>`.** Runtime-compatible — nothing changes if you just render the
  component — but a type-level break for anyone who imported and typed against it directly.

- **Status action buttons are now labelled as actions, not as the target status name** — e.g. a
  button that moves a reservation to `confirmed` now reads **Confirm** rather than "Confirmed".
  The five built-in statuses get **Reopen** (back to `pending`), **Confirm**, **Complete**,
  **Cancel**, and **Mark no-show**. A custom status with no matching translation falls back to
  its existing status label, then the title-cased raw status. `useReservationStatusMachine`
  exposes this mapping as `actionLabels`; the pure helper it's built from,
  `buildStatusActionLabels`, is newly exported from `payload-reserve/client` and the package root.

- **A custom status may render in a different colour than before, and now gets a matching text
  colour.** Palette assignment changed from "index into the whole `statuses` array" to "index
  over custom (non-built-in) statuses only" — for a machine like `['pending', 'confirmed',
  'waitlisted']`, the `waitlisted` swatch changes, and now has an explicit foreground colour
  instead of inheriting the default. Built-in statuses (`pending`, `confirmed`, `completed`,
  `cancelled`, `no-show`) are unaffected — their exact background/foreground pairs were carried
  over verbatim.

- **The pending list's quick-action (✓/✗ buttons) failures now render the server's own error
  message instead of the generic `reservation:pendingConfirmError`/`pendingCancelError`
  strings** — for example, a notice-period rejection now shows the real sentence. This applies
  **even with `components.reservationDetail: false`**, which is why that flag restores v3.1.1
  **click** behaviour, not v3.1.1 behaviour byte-for-byte.

- **The fetch behind the detail drawer's status mutations (`patchReservation` /
  `performReservationPatch`) now sends `credentials: 'include'`**; previously it sent none, which
  defaults to `same-origin`. Better for a cross-origin `serverURL`, but undisclosed until now.

### Added

- **Clicking a reservation (on the calendar, or a row in the Pending view) now opens a detail
  drawer first** — a status badge, key fields, and a status action bar wired to the real
  transition rules — rather than jumping straight to the document edit form. An **Edit** button
  in the drawer opens the full form for anyone who needs it. Opt out entirely with
  `components.reservationDetail: false` to restore the previous click-straight-to-edit behaviour
  (see the Breaking notes above for the one way this isn't quite byte-for-byte).

- **New plugin option, `components`, lets you replace any of six admin components with your own
  Payload component, without forking the plugin:**

  ```typescript
  payloadReserve({
    components: {
      dashboardWidget: false,
      reservationDetail: '/components/MyReservationDetail.tsx#MyReservationDetail',
    },
  })
  ```

  Each slot (`calendarView`, `customerField`, `availabilityTimeField`, `dashboardWidget`,
  `availabilityOverview`, `reservationDetail`) takes a component path string, `false` to opt out,
  or stays unset to use the plugin's own component. `false` is asymmetric: for the first five it
  falls back to a Payload default; `reservationDetail` has none, so `false` there restores v3.1.1
  click behaviour instead (see Breaking, above). **Run `payload generate:importmap` after setting
  any slot to a string** — same reason as the upgrade step above: a stale import map means silent
  non-rendering.

- **Newly exported UI parts for composing custom admin views.** `payload-reserve/client` now
  exports the primitives and hooks the built-in detail drawer is composed from — `DetailRow`,
  `EventPill`, `ReservationDetail`, `ReservationDetailProvider`, `StatusActionBar`, `StatusBadge`,
  `useReservationDetail`, `useReservationMutations`, and `useReservationStatusMachine` — so a
  replacement `reservationDetail` component doesn't have to reinvent them. `payload-reserve/rsc`
  newly exports `CalendarViewServer`, the server wrapper that resolves
  `components.reservationDetail` out of the import map and hands the client calendar a
  pre-rendered element; it is now the calendar's default list-view component, up from the plain
  client `CalendarView`. The UI types and helpers a replacement component needs —
  `ReservationItem`, `ResourceOption`, `buildStatusLabels`, `buildStatusPresentation`,
  `BUILTIN_STATUSES`, `StatusPresentation`, and `CalendarReservation` — are now also exported
  from `payload-reserve/client`, not only the server-only package root, so a `'use client'`
  detail component no longer needs to import the server plugin barrel. `buildStatusLabels`'s
  translate-function parameter is also widened from the plugin's internal, unexported `PluginT`
  to a plain `(key: string) => string`, so it can be called from outside the plugin.
  `StatusActionBar` also gained an optional `noActionsFallback` prop (`React.ReactNode`, default
  `null`) — rendered in place of the bar when the current status has no outgoing transitions —
  fully backward compatible, since omitting it preserves the existing render-nothing behaviour.

### Fixed

- **Hyphenated/underscored custom statuses now render correctly.** A custom status like
  `awaiting-deposit` used to fall back to `Awaiting-deposit` (only the first character
  capitalised) when no translation was configured for it. It now title-cases each hyphen- or
  underscore-separated word instead: `Awaiting Deposit`. Built-in statuses always resolve through
  a real translation, so this fallback never applied to them.

- **Fixed a rare stale-paint bug in the reservation detail drawer:** closing a reservation while
  a status-change mutation was still in flight, then reopening the _same_ reservation before that
  mutation resolved, could paint the earlier request's result — a success/error banner, a
  disabled button — into the reopened drawer. The guard now tracks a monotonically increasing
  request generation rather than comparing reservation ids, which couldn't distinguish "a
  different reservation is now open" from "the same reservation was closed and reopened."

- **The detail drawer's rows are now width-constrained instead of stretching across the full
  viewport.** Payload's `Drawer` sets its content width by design (essentially full-viewport at
  depth 1, the same as Payload's own document drawer), so at a wide viewport each label/value row
  used to read as two words separated by an enormous gap. The drawer body now caps its measure at
  600px, left-aligned. This applies to a consumer's own `detailSlot` replacement too, not only the
  built-in `ReservationDetail` — both render inside the same drawer-side wrapper.

- **Footer buttons (the status action bar plus Edit) now sit on one baseline under a single
  full-width rule**, instead of the rule stopping short of Edit and Edit sitting higher than the
  other buttons. `StatusActionBar` no longer draws its own border/padding above its buttons — that
  responsibility moved to `ReservationDetail`'s footer, which now owns the single rule spanning
  the whole row. `StatusActionBar` is otherwise unaffected and still renders correctly when used
  standalone.

### Internal

- The repo gained a jsdom component-test project (`@testing-library/react`), so the admin
  components have real test coverage for the first time. The suite went from 550 to 661 tests —
  most of the confidence behind this release comes from those new tests, not just the manual
  passes noted above.

## [3.1.1] - 2026-08-13

Two admin-panel fixes. Both are long-standing rather than regressions: one made
the calendar silently ignore clicks, the other meant a dashboard widget this
plugin ships had never rendered for anyone. No schema changes, no API changes,
no migration.

### Fixed

- **The calendar silently swallowed any click that re-requested the document it was already holding — most visibly, "Create New" did nothing at all on a freshly loaded calendar.**

  `CalendarView` opens its document drawer indirectly: a click sets `drawerDocId` state, and an effect calls `openDrawer()` on the resulting render. That indirection is necessary, because `useDocumentDrawer` bakes the document id into the modal slug — opening synchronously from the click handler would target the _previously_ opened document. What it assumed was that a render would always follow.

  When a click set `drawerDocId` and `initialData` to the values they already held, React bailed out of the re-render entirely. No render meant the effect never ran, and the click did nothing. Three consequences, all reproduced in a browser:
  - **"Create New" was dead on a freshly loaded calendar.** On mount `drawerDocId` is already `null` and `initialData` already `undefined`, so the button set both to what they already were. It only began working after some other document had been opened and closed.
  - **A reservation could not be reopened after closing its drawer** — from the month, week and day event blocks (mouse or keyboard) and from the pending tab's customer link. Clicking a _different_ reservation still worked, which is why this read as intermittent rather than broken.
  - **A drawer could open by itself.** The swallowed click left the open request armed, so the next unrelated re-render — changing month, a background refetch — consumed it and opened the drawer with no click at all.

  The open request is now carried on a monotonic counter, which always produces a new value, so the render the effect depends on is guaranteed. All seven entry points route through a single `requestDrawer` helper. The three click-to-book handlers were never affected, but only by accident: they pass a fresh object literal to `setInitialData`, which is never equal to the previous value. Routing them through the same helper means memoizing that object can no longer reintroduce the bug.

- **The "Today's Reservations" dashboard widget had never rendered, in any release that shipped it.**

  `admin.dashboard.widgets` only _registers_ a widget. Payload renders whatever `admin.dashboard.defaultLayout` lists, resolving each entry's component by slug. The plugin pushed its widget into `widgets` and never added it to `defaultLayout`, so the widget was registered, present in the import map, and never placed on the dashboard.

  The placement now happens at init rather than at plugin time, and that ordering is load-bearing. Payload sanitizes the config _after_ plugins run, and sanitize both appends its own `collections` widget and sets `defaultLayout ??= [{ widgetSlug: 'collections' }]`. Assigning `defaultLayout` from plugin code would win over that `??=` and drop the Collections cards off the dashboard — trading this bug for a worse one. By `onInit` the default is materialised and the widget can be appended to it.

  A `defaultLayout` supplied as a function is wrapped rather than replaced, an existing entry for the widget is never duplicated, and the whole step is guarded so it can neither break boot nor suppress the plugin's other boot diagnostics.

  **You may need to reset your dashboard layout to see it.** Payload gives a user's _saved_ dashboard preferences precedence over `defaultLayout`, so anyone who has already customised their dashboard keeps the layout they saved and can add the widget themselves. That is Payload's own behaviour, not something this fix can override.

### Internal

- Repaired 14 end-to-end tests that could never pass, and added coverage for the drawer paths above, which had none. The failures were Playwright strict-mode violations (locators such as `{ name: 'Day' }` also matching "Today"), a loading-state check reading `document.querySelector('*').textContent` — which is `<html>`, and includes `<script>` contents, so a string inlined into Next.js's RSC payload made the condition permanently false — and one assertion expecting a bare weekday abbreviation where the grid renders "Sun 9". The suite goes from 15 failing / 10 passing to 28 passing. Note that end-to-end tests still do not run in the release pipeline, which is why a widget that never rendered went unnoticed.

## [3.1.0] - 2026-08-12

Released as a **minor** rather than a patch: the fix below rejects input that
previously succeeded, so this is not a safe blind bump for anyone booking
`flexible` services without an `endTime`. Read "Upgrading" before updating.

### Fixed

- **A `flexible`-duration booking could be stored with a NULL `endTime`, which made it invisible to conflict detection and allowed the same slot to be sold repeatedly.**

  `calculateEndTime` branches on how many real `items[]` a reservation has, and the two branches disagreed about what a `flexible` service with no caller-supplied `endTime` meant. The single-resource branch rejected it (`endTime is required for flexible duration services`). The multi-resource branch skipped the item, which left the top-level span underived and stored the row with a NULL `endTime`.

  That mattered because `endTime` is what every safety check is built on. `buildCoarseOverlapQuery` filters on `endTime greater_than`, so a NULL-`endTime` row was never fetched for any other booking's conflict check; `itemsToOccupancies` skips an item without an end, so it contributed no occupancy; and `validateConflicts` skipped such an item too, so the offending booking was itself checked against nothing. The slot could then be booked repeatedly, with no error raised on any attempt.

  It did not require a multi-resource booking to reach. `expandRequiredResources` expands a service's `requiredResources` into `items[]`, so a service that is **both** `flexible` **and** carries any `requiredResources` took the multi-resource branch on an ordinary single-resource create — one caller, one resource, no multi-resource API involved.
  - `calculateEndTime` — a `flexible` item with no `endTime` of its own now inherits the top-level `endTime` (the same backfill `resolveReservationItems` performs) and is materialised onto the stored item. When no end can be inherited it raises the same `ValidationError`, with the same message and path, as the single-resource branch has always raised. An item whose window inverts against its own start is rejected, which the multi-resource branch never checked.
  - `calculateEndTime` — a single chokepoint before the hook returns now refuses any reservation whose window could not be bounded, covering both branches and any future skip. It catches every path that reaches the end of the hook; the early returns above it (most importantly an update touching no scheduling field) deliberately bypass it, which is what keeps a row already stored with a NULL `endTime` editable and cancellable rather than trapped.
  - `validateConflicts` — an item with no `endTime` is refused rather than skipped. A booking that cannot be bounded cannot be checked, and silently checking nothing was the worst available response. After the chokepoint above this is unreachable through the collection's own hook chain; it remains reachable for a host that reorders or replaces hooks via `collectionOverrides.reservations`.

### Upgrading

- **A `flexible` service booked with no `endTime` is now rejected on every path**, where a service with `requiredResources` previously stored an unbounded reservation. Callers that relied on that must send an `endTime` — `startTime + service.duration` reproduces the window the availability API already advertises for flexible services, since `getAvailableSlots` sizes flexible slots by `service.duration`.

- **Existing data is not repaired by this release.** Reservations already stored with a NULL `endTime` stay invisible to conflict detection, so their slots remain oversellable. Find them with an `endTime exists: false` query on the reservations collection.

  Repair order matters where two rows share a slot: cancel the losers **first**, then set an explicit `endTime` on the survivor. Repairing re-runs conflict detection, so with both rows still live the second repair is refused. Note that `validateCancellation` blocks a cancel inside `cancellationNoticePeriod` and has no admin bypass, so cancelling a row starting within that window needs `context: { skipReservationHooks: true }` — which also skips the `afterBookingCancel` hooks. No migration ships with this fix.

## [3.0.1] - 2026-07-30

### Fixed

- **The published package could not be imported by plain Node ESM at all.** `import('payload-reserve')` threw `ERR_IMPORT_ATTRIBUTE_MISSING: Module ".../dist/translations/ar.json" needs an import attribute of "type: json"`, so anything loading the built package outside a bundler — a plain Node script, a native-ESM test runner, a non-bundled server entry point — failed on import before reaching any plugin code.

  `src/translations/index.ts` imports its 12 locale files as `import ar from './ar.json' with { type: 'json' }`, which TypeScript requires under `module: NodeNext` and Node >= 22 enforces at runtime. **SWC strips that attribute by default**, so the emitted `dist/translations/index.js` carried bare `import ar from './ar.json';`. `.swcrc` now sets `jsc.experimental.keepImportAssertions`, and all 12 attributes survive compilation.

  **Present in 2.4.0 and 3.0.0** (verified against both published tarballs), so this is a long-standing packaging defect rather than a regression from the 3.0.0 concurrency work.

  Most consumers were never affected and need do nothing: a Payload app loads its config through a bundler (Next.js/Turbopack/webpack), and bundlers resolve JSON imports with no attribute required. That is also why no test caught it — the integration suite imports the plugin from `src/`, where the attribute is present by definition, so the build config was never exercised. A regression test (`dev/buildArtifacts.spec.ts`) now compiles the real file with the real `.swcrc` through the same `swc` binary `pnpm build:swc` uses and asserts every JSON import keeps its attribute; it fails if the flag is removed.

## [3.0.0] - 2026-07-30

This release exists because a test proved the plugin never prevented concurrent
double-booking at all. Read the first breaking change and the migration notes
before upgrading a production install — two of the changes can alter the
availability of reservations **already in your database**, with no write
occurring.

### Breaking

- **Concurrent bookings were not prevented at all before this release.** Measured on MongoDB: 10 simultaneous `POST /api/reserve/book` calls for one `quantity: 1` slot produced 10 confirmed reservations; 8 simultaneous calls against a `quantity: 3` resource produced 8. A new hidden `bookingLock` text field on Resources, written by a new `acquireBookingLock` `beforeChange` hook inside the booking's own transaction, now serializes concurrent claims of the same resource so the database — not the plugin — forces the losers to wait or abort.
  - **Schema addition — Postgres/SQLite consumers need a migration** to add the `bookingLock` column to the `resources` table before upgrading (MongoDB is schemaless and needs nothing).
  - **Retry is required on MongoDB and does nothing on Postgres.** MongoDB's loser aborts immediately (`WriteConflict`, code 112) rather than waiting, so without retry a `quantity: 3` resource recovers only 1 of 3 under a burst; `retryOnWriteConflict` recovers the full 3 of 3. Postgres's loser _blocks_ until the winner commits and then proceeds through the normal conflict check on the merits, so retry never fires there — measured 3 of 3 recovered with no retry needed. The retry budget is finite (5 attempts), so recovery is not a guarantee at extreme contention: a measured 40-way burst against a `quantity: 5` resource granted 3 and returned 37 clean `409`s. Capacity is never exceeded; it can be under-filled.
  - **SQLite requires `transactionOptions` set on the adapter, or the lock is a silent no-op and bookings double-book exactly as before this release.** Configured correctly, SQLite does not double-book, but capacity is capped at 1 of 3 even with retry attempted — for bookings **and for slot holds**, which share the same lock and the same retry path (an upstream `@payloadcms/drizzle` limitation: the driver's structured error code is discarded before this plugin's retry logic ever sees it) — and `POST /api/reserve/book` returns a raw HTTP 500 under SQLite contention rather than the clean `409` MongoDB and Postgres get. See README's "Concurrent booking: database adapter support" for the full measured, per-adapter matrix and consumer guidance.
  - **Side effect worth knowing about: every booking now touches each claimed Resource's `updatedAt`.** Taking the lock is a write to the Resource document, so on MongoDB (where the collection carries timestamps) creating, rescheduling, or cancelling a reservation bumps the `updatedAt` of every Resource that booking claims — including the pools pulled in by a Service's `requiredResources`. Nothing reads the lock value, but if you sort Resources by `updatedAt`, cache-key on it, drive an incremental sync from it, or surface "last modified" in your admin UI, expect churn proportional to booking volume rather than to actual Resource edits.

- **Deleting a Service or Resource that is still referenced now fails deliberately** with an actionable `400` naming what's blocking, e.g. `Cannot delete this resource: 2 reservations and 1 schedule still reference it. Uncheck "active" to retire it instead — that stops new bookings while keeping existing ones intact.` Previously MongoDB allowed the delete silently, leaving the referencing document pointing at nothing; Postgres/SQLite always failed the same delete, but with a raw, un-actionable `23502`/`SQLITE_CONSTRAINT_NOTNULL` constraint error rather than this message. Set `active: false` instead of deleting to retire a Service or Resource while keeping its booking (or schedule) history intact.

- **A reservation's top-level `resource` is now conflict-checked even when the request also supplies an explicit `items[]` that never names it.** `resolveReservationItems` (exported from the package root) always synthesizes an extra item from the top-level `resource`/`startTime`/`endTime` — flagged `fromParent: true` on the returned `ResolvedItem` — unless an `items[]` entry for that resource can already be shown to cover the same window. Bookings that previously slipped past conflict detection this way (top-level resource A booked while `items[]` names only other resources) are now rejected. `ResolvedItem` gained the optional `fromParent?: boolean` field, and **direct callers of `resolveReservationItems` should expect the returned array to sometimes contain one more entry than before.**

  **This changes read-side availability for rows already in your database, not just future writes.** `reservationOccupancies` runs `resolveReservationItems` over stored reservations, so the synthesized parent is resolved for existing rows too — a resource that `getAvailableSlots`/`checkAvailability` reported as free before the upgrade can become busy afterwards with **no write occurring**. The effect is largest in the `calculateEndTime`-spanned shape (top-level resource C with `items[]` naming only A and B): the parent's window spans earliest-start→latest-end, so C can be blocked for hours. This is the correct semantics — the row genuinely does claim C — but **slots can disappear the moment you deploy**. Check for reservations with a top-level `resource` absent from their own `items[]` before upgrading a production install.

- **A partial update patch that changes only `startTime` on a multi-resource booking** — landing later than the reservation's currently-stored `endTime`, with `items[]`/`endTime` left untouched — now hard-errors (`endTime must be after startTime`) instead of being silently absorbed as a no-op. This closes a gap where `resolveReservationItems` would previously synthesize a harmless-looking phantom item from an inverted top-level window rather than rejecting the malformed input at the source. The read path (`reservationOccupancies`, used by `checkAvailability`/`getAvailableSlots`) tolerates a pre-existing malformed row leniently — it will not newly crash an availability check because of a row that predates this release — but the same shape is now rejected on write.
  - **This also changes `resolveReservationItems` itself, which is a documented public export** (`import { resolveReservationItems } from 'payload-reserve'`). Called directly with an inverted top-level window it now throws a `ValidationError` where it previously returned an array containing a synthesized phantom item. If you call it outside the plugin's own hooks — to pre-validate a booking payload, to compute occupancy in your own reporting, or anywhere else — wrap it or validate `endTime > startTime` upstream. A second argument is available for the read-path behaviour: `resolveReservationItems(data, { lenient: true })` skips the phantom-item synthesis instead of throwing, which is what `reservationOccupancies` uses so a pre-existing malformed row cannot break an availability read.

- **`/api/reservation-customer-search`, `/api/reserve/resource-availability`, `/api/reserve/cancel`, and `/api/reserve/effective-timezone` now enforce the underlying collection's access control** (`overrideAccess: false` + `req`) instead of reading privileged. This is **per-path, not a blanket flip** — each endpoint gates the request with one explicit access-checked call and keeps its derived reads privileged so it can still assemble a complete answer:
  - `/api/reservation-customer-search` — the customer query itself delegates.
  - `/api/reserve/resource-availability` — a `findByID` probe of the **requested resource** delegates (404 on denial). The reads that build the grid stay privileged, deliberately: a conflicting booking you cannot see is a double-booking.
  - `/api/reserve/cancel` — **only** the privileged-non-owner update delegates. The reservation read, and the update on the owner and guest-token paths, stay privileged by design — for a guest the cancellation token _is_ the authorization, and owner-mode's `update: adminOnly` would otherwise block a customer cancelling their own booking. Ownership/token are checked in the endpoint before either path is taken.
  - `/api/reserve/effective-timezone` — the tenant-document read delegates, falling back to the global zone on denial.
  - **`POST /api/reserve/book` is deliberately NOT covered.** Its `payload.create` stays privileged for every caller, exactly as in every earlier release: anonymous guest bookings have no `req.user` to authorize, and under `resourceOwnerMode` a `create: adminOnly` rule would block an authenticated customer booking for themselves. Its security boundary is the access-checked tenant-membership probe described under **Fixed**, below — not `overrideAccess`, which cannot constrain a `create` at all (Payload's create access check only inspects truthiness and never applies a returned `Where` the way read/update/delete do). Consequently a consumer's own `access.reservations.create`, and any field-level `create` access added through `collectionOverrides.reservations`, are still not applied to bookings made through this endpoint — put such a rule in a `beforeChange` hook or in `hooks.beforeBookingCreate`, both of which do run.

  Plain installs (no `resourceOwnerMode`, no `multiTenant`, no custom `access` overrides) are unaffected — Payload's own default access is `({ req: { user } }) => Boolean(user)`, so an authenticated user still passes. Two cases now behave differently:
  - If your `userCollection` defines its own restrictive `access.read` (e.g. scoping a user to their own record), `/api/reservation-customer-search` now respects it — the endpoint no longer out-permissions the collection it reads from. Customer-search results narrow accordingly; the fix, if unwanted, is in that collection's own `access.read`.
  - Under `resourceOwnerMode`, a staff user (a role in `staffRoles` but **not** `adminRoles`) can now only pull `/api/reserve/resource-availability` for their **own** resource, matching the restriction the Resources collection already applies elsewhere. Add the role to `adminRoles` to keep the wider view for that user.

- **`active: false` on a Service or Resource is now enforced at booking time.** Creating a reservation against an inactive service/resource (or any multi-resource `items[]` entry referencing one) is rejected, as is updating a reservation to newly reference one **or to reschedule it** — any change to `startTime`, `endTime`, `service`, `resource`, `items`, or `guestCount` re-checks every reference, so a booking cannot be moved onto a resource that availability would refuse to offer. Inactive services/resources are also excluded from availability. Edits that do not touch scheduling are unaffected: an existing booking stays confirmable, cancellable, and otherwise editable after its service or resource is deactivated later. Set `enforceActive: false` in the plugin config to restore the previous behaviour, where `active` was purely a display flag with no effect on booking or availability.

- **`getAvailableSlots` now returns `{ reason?, slots }`** instead of a bare `Slot[]` array. Direct importers must update destructuring, e.g. `const { slots } = await getAvailableSlots(...)`. The `EmptyReason` type is exported alongside it (from both `src/index.ts` and `src/services/index.ts`) and describes why `slots` came back empty (e.g. `'service_inactive'`, `'resource_inactive'`, `'no_windows'`, `'window_too_short'`, `'all_slots_taken'`).

- **`peerDependencies` now require `payload ^3.86.0`, `@payloadcms/ui ^3.86.0`, and `@payloadcms/translations ^3.86.0`** (was `^3.79.0`). Upgrade Payload before upgrading this plugin.

### Added

- **Opt-in `slotHolds`** — short-lived claims on a slot taken while a customer completes checkout, so it can't be booked out from under them. Enabling it (`slotHolds: { enabled: true, ttlMinutes?: number }`) adds a `reservation-holds` collection and two new endpoints, `POST /api/reserve/hold` and `POST /api/reserve/hold/release`; `POST /api/reserve/book` accepts an optional `holdToken` to convert a hold into a booking. Left unset (the default), no collection is added, no new endpoints are registered, and availability behaviour is byte-identical to before.
  - A hold's `token` is a bearer secret, so the `reservation-holds` collection is **closed to the REST API on all four operations**, `read` included — `GET /api/reservation-holds` is denied for every caller including admins, since reading a live token is enough to release someone else's hold or book their slot. If you enable `slotHolds` under `multiTenant`, add the holds slug to the multi-tenant plugin's own `collections` option; the boot diagnostic now warns when you don't.
  - Held slots are excluded from the **read** path too, not only from bookings: `/api/reserve/availability`, `/api/reserve/slots` and `/api/reserve/resource-availability` all treat an unexpired hold as busy, so no customer-facing path offers a slot the booking endpoint will then refuse. That covers the reservation form's slot picker and the admin **Calendar** view. **Known limitation:** the admin **Availability grid** (`AvailabilityOverview`, at `/reservation-availability`) does _not_ — it queries the `resources`, `schedules` and `reservations` REST endpoints directly and computes its grid client-side, so a held slot still reads as free there. Display-only and admin-only: it cannot cause a wrong write, because every write goes through `checkAvailability`, which does count holds.
  - `POST /api/reserve/hold` maps outcomes to distinct statuses rather than collapsing every failure into a `409` carrying an internal error message: `409` for genuine unavailability (`slot_taken`, `service_inactive`), `409 { retryable: true }` when lock contention outlived the retry budget, `404` for `service_not_found`/`resource_not_found`, `400` for malformed input — including an unparseable `endTime` or a `guestCount` below 1, both of which previously surfaced as a misleading `409 slot_taken` or an outright `500` — and a `500` only for an actual server-side failure. No internal error text is echoed to this (unauthenticated) endpoint.

- `/api/reserve/book` and `/api/reserve/cancel` now map a surviving write conflict to a clean HTTP `409 { retryable: true }` instead of an unhandled 500 (MongoDB and Postgres; not SQLite, per the concurrency notes above).

- **New boot warning** when the configured database gives Payload no transactions at all (a standalone, non-replica-set MongoDB, or SQLite without `transactionOptions`) — the lock silently protects nothing in that configuration, and there is no other runtime signal.

- **New boot warning** when multi-tenancy appears to be enabled but one of this plugin's own collections (`reservations`, `resources`, `schedules`, `services`, plus `customers` in standalone mode) is not tenant-scoped — which happens when `payloadReserve()` is listed after `multiTenantPlugin()` in the `plugins` array, or when its slugs were left out of multi-tenant's own `collections` option. `payloadReserve()` must run before `multiTenantPlugin()` for tenant-field detection to work at all. Detection is a **heuristic** with two signals, either of which arms the check: some collection carries a top-level tenant field, or an auth collection carries multi-tenant's `tenants` membership array. Neither is exact — the membership array is absent under `tenantsArrayField.includeDefaultField: false` and its name is configurable — so the warning may occasionally fire on a config that merely looks tenant-shaped. It is only ever a warning and never blocks boot.

- Services now show a read-only `resources` field — a join over `Resources.services` — listing which resources perform that service. `Resources.services` remains the only editable side; this is purely a reverse view for the admin UI and API reads.

- Empty availability responses from `/api/reserve/availability` and `/api/reserve/slots` now carry a machine-readable `reason` field explaining why no slots were returned.

- `window_too_short` — availability now distinguishes "every shift is shorter than the service duration" from "the day is fully booked", instead of reporting both as `all_slots_taken`.

- The plugin logs a warning at init when the Services `resources` join is skipped because a `collectionOverrides.resources` override removed, renamed, or nested the `services` field — previously the field simply went missing with no explanation.

- The dashboard widget's five aggregate reads are now access-checked (`overrideAccess: false`, with `disableErrors: true` so an access denial renders zeros rather than throwing out of the React Server Component), extracted into the testable `fetchDashboardStats` helper; `getEffectiveTenantTimezone` gained an optional `req` and access-checks the tenant-doc read whenever one is passed (all current call sites pass one).

### Fixed

- **`POST /api/reserve/book` no longer lets an authenticated `multiTenant` caller create a reservation in a tenant they aren't a member of** by supplying an explicit `tenant` in the request body. An access-checked membership probe (`callerMayUseTenant`) now runs for every authenticated caller — it, not `overrideAccess`, is this endpoint's security boundary, because Payload's `create` access check only inspects truthiness and never applies a returned `Where` the way read/update/delete do, so no `overrideAccess` setting can constrain _which_ tenant is written to. A `hasMany` tenant field is supported (every id in the array is probed), and a tenant value in a shape the plugin cannot read is refused with a logged warning rather than silently. (In standalone mode — no `userCollection` — this probe cannot verify a customer's actual tenant membership, since customers authenticate against a collection multi-tenant never wraps; the plugin now warns about this specific configuration at boot.)

- **A `hasMany` tenant field no longer breaks booking entirely under `multiTenant`.** Such an install sends `tenant: [id]`; the membership probe could not read an array value and failed closed, so **every** authenticated booking carrying an explicit tenant was refused with a `403` — fail-closed, but a total booking outage with no diagnostic. Every id in the array is now probed, an empty array is treated as "no tenant supplied", and a value in a shape the plugin genuinely cannot read still refuses but logs a warning naming the shape.

- **The plugin no longer issues concurrent Payload Local API reads on one `req` inside a transaction.** A MongoDB `ClientSession` cannot carry concurrent operations inside a transaction, and Payload's read operations call `killTransaction` from their own catch even though they never opened one — so when two collided, the loser rolled back and cleared the transaction the enclosing `create`/`delete` owned, and the survivor failed with `NoSuchTransaction` ("transaction number N does not match any in-progress transactions"). Symptoms in production: deleting a referenced Service or Resource could fail with that opaque error instead of the actionable `400`, and — because `NoSuchTransaction` carries MongoDB's `TransientTransactionError` label — a booking could burn its whole retry budget and return `409 { retryable: true }` **for a genuinely free slot** under load. Three loops are now sequential: the delete guard's reference counts, and `checkAvailability`'s reservation- and hold-occupancy resolution. Buffers are cached per service, so this is at most one read per _distinct_ neighbouring service either way.

- **A `req` could be left permanently poisoned after a failed `beginTransaction`.** Payload's `initTransaction` stores the pending promise on `req.transactionID` before awaiting it, and `killTransaction`'s cleanup guard skips promises — so if `beginTransaction` _rejects_, that rejected promise stays on the `req` and every later Payload operation on it short-circuits and re-throws the original error without ever reaching the database. `retryOnWriteConflict` now clears a leftover between attempts (never one the caller already owned), and the slot-hold expiry sweep — documented as unable to fail a hold — clears it in its own catch, since it swallows the error mid-attempt where the retry wrapper cannot see it. This is unrelated to SQLite's separate "raising the retry budget changes nothing" behaviour, which has its own cause: `@payloadcms/drizzle` strips the driver's structured error code, so the conflict is never recognised as transient and the retry loop exits on its first attempt.

- **The admin Calendar's grid instants, click targets, day-key sequences, and month/week header labels now resolve in the plugin's business timezone** (`timezone`, or the selected tenant's zone under `multiTenant`) instead of the browser's local timezone. Previously, viewing the calendar from a different timezone than the business's could make clicking a displayed slot book a different wall-clock hour than the one shown.

  **Known gap:** the reservation drawer's `startTime` field is still a `datetime-local` input with no business-timezone awareness, so it renders in the **browser's** zone. Clicking the "10:00" row of an Auckland-business calendar from Paris now pre-fills the correct instant, but that instant _displays_ as `00:00`. Saving as-is stores the right time — a strict improvement over the previous behaviour — but an admin who "corrects" the displayed value back to `10:00` reintroduces the original bug. Treat the calendar grid, not the drawer field, as the source of truth for the intended slot.

### Documented, not changed

- Every plugin lifecycle hook this plugin fires (`afterBookingCreate`, `afterBookingConfirm`, `afterBookingCancel`, `afterStatusChange`) runs **inside** the write's own database transaction, never after it commits — verified directly against Payload's own operation code. Payload exposes no post-commit hook point, so a host whose side effect must never fire for an uncommitted booking should make it idempotent and reconcile, rather than relying on hook-vs-commit ordering. See README's "Hook timing" section.

### Migration notes

**Database schema**

- **Postgres and SQLite consumers must add the new `bookingLock` text column to the `resources` table before upgrading** (nullable, no default required — the value is written but never read). If your dev/staging setup auto-syncs schema (`push: true`), this happens for you there; production Postgres needs a real migration. This is unrelated to whether you use `slotHolds`.
- **SQLite consumers must add `transactionOptions` to `sqliteAdapter(...)`** or the new booking lock silently protects nothing — concurrent bookings will double-book exactly as they did before this release, with no error. See README for the full adapter-support matrix, including SQLite's separate, accepted capacity-recovery and 500-vs-409 limitations.
- If you enable `slotHolds`, run `pnpm dev:generate-types` (or your own types workflow) after upgrading to pick up the new `reservation-holds` collection, and apply a migration for it on Postgres/SQLite the same way you would for any other new collection. Under `multiTenant`, add its slug to the multi-tenant plugin's `collections` option at the same time.

**Audit before upgrading**

- **Audit existing reservations whose top-level `resource` is not named in their own `items[]`.** Those rows now occupy that resource on the read side too, so previously-bookable slots can vanish without any write.
- **Check for any script, seed, or admin workflow that deletes a Service or Resource still referenced by a reservation or schedule** — that delete will now fail. Use `active: false` to retire it instead.
- **Audit any update flow that patches only `startTime` on a multi-resource booking without also updating `items[]`/`endTime`.** A patch that lands the new `startTime` after the stale, already-stored `endTime` is now rejected rather than silently doing nothing.

**Code changes**

- **If you call `resolveReservationItems` directly**, note it now throws on an inverted top-level window instead of returning a phantom item — pass `{ lenient: true }` for the previous non-throwing shape, or validate upstream. Also account for the new synthesized `fromParent` entry if anything depends on the returned array's exact length.
- **If you import `getAvailableSlots` directly**, update destructuring to `const { slots } = await getAvailableSlots(...)`.
- **If anything you own keys off a Resource's `updatedAt`** — sorting, caching, incremental sync, a "last modified" column — expect it to change on every booking now, not only on real Resource edits.
- If your `collectionOverrides.services` already appends a field named `resources`, rename it — it now collides with the built-in join. (The name used in the docs, `referencedResources`, is a different name and is unaffected.)
- If your `collectionOverrides.resources` removes, renames, or nests the `services` field inside a named group or tab, the new Services `resources` join is silently skipped rather than added — the app still boots, the field simply doesn't appear.

**Access control and multi-tenancy**

- If staff (non-admin, per `resourceOwnerMode.adminRoles`) users rely on `/api/reserve/resource-availability` to view resources they don't own, add their role to `adminRoles`.
- If your `userCollection`'s `access.read` is more restrictive than "any authenticated user," expect `/api/reservation-customer-search` results to narrow to match it.
- If you use `multiTenant`, verify `payloadReserve()` precedes `multiTenantPlugin()` in your `plugins` array and that this plugin's collection slugs — **including `customers` in standalone mode** — are listed in multi-tenant's `collections` option. The plugin will now warn at boot if they aren't. Leaving `customers` out means `/api/reservation-customer-search` keeps returning every tenant's customers, because there is no tenant field for it to filter on.
- If you rely on `access.reservations.create` or field-level create access to gate bookings, move that rule into a `beforeChange` hook or `hooks.beforeBookingCreate` — `/api/reserve/book`'s create is privileged and does not apply collection create access (unchanged from earlier releases).

## [2.4.0] - 2026-07-24

### Added

- **Opt-in `debug` tracing for availability.** A new `debug?: boolean` plugin option
  (default `false`) emits info-level `reserve_debug` Pino logs — one event with a `stage`
  field and a per-call `traceId` — tracing slot generation and conflict detection. Every
  silent empty-return in `getAvailableSlots`/`checkAvailability` now logs its exact reason
  and inputs; per-stage candidate counts are logged on success; the availability/slots
  endpoints and the `validateConflicts` write path emit request/response and conflict
  decisions; and previously-swallowed `bufferFor`/`getExternalBusy` errors surface under
  the Pino `err` key (still fail-open). Emits at `info` (not `debug`) so lines survive
  Pino's default production level; no output and no overhead when disabled.

## [2.3.0] - 2026-07-03

### Added

- **Month view renders external busy intervals as pills.** Events from `getExternalBusy`
  now appear in month day-cells as distinct, non-clickable hatched pills (timed events show
  "HH:MM label", all-day events show the label only), alongside reservation pills. Rendered
  only when a resource is selected (or auto-selected on single-resource installs) — same
  rule as the week/day availability shading.

### Fixed

- **CalendarView: selecting a resource emptied the calendar on Postgres installs.** The
  client-side resource filter compared ids with strict `===`, but Postgres serves numeric
  ids over REST while the filter value (a `<select>` value, or 2.2.1's single-resource
  auto-select) is a string — so `8 === '8'` never matched and every reservation was hidden.
  2.2.1 made this fire with no user action on single-resource installs. Ids are now
  compared string-normalized (`reservationMatchesResource` / `sameId`, unit-tested); the
  same fix applies to the Lanes view's resource list, which had the identical mismatch.

## [2.2.1] - 2026-07-03

### Fixed

- **CalendarView: single-resource installs never showed availability shading.** The resource
  filter only renders when there are 2+ resources, and nothing auto-selected the sole
  resource — so week/day views never loaded shift windows, full/time-off shading, or the
  new `external` slots. The sole resource is now auto-selected; installs with multiple
  resources are unchanged (selection stays manual via the filter).

## [2.2.0] - 2026-07-03

A minor, additive release: an app-supplied resolver for folding external busy time (e.g. calendar sync) into availability. **No breaking changes** — installs that don't configure `getExternalBusy` are unaffected.

### Added

- **`getExternalBusy` plugin option.** An app-supplied resolver that maps a resource and time window to external busy intervals (e.g. a Google/Outlook calendar-sync table), so third-party events are folded into this plugin's availability logic.
- **Enforcement in `checkAvailability`.** An external interval blocks the WHOLE resource (all `quantity` units) — external calendars aren't unit-aware. The resolver is called inside try/catch and treated as fail-open: a resolver error never blocks a real booking.
- **`external[]` in the resource-availability endpoint response**, carrying the resolved external intervals for the requested window.
- **`external` slot state in CalendarView**, rendered as a distinct, non-clickable hatched slot, with `slotExternal` translations added in all 12 supported languages.

## [2.1.1] - 2026-06-19

A patch release fixing two multi-tenant issues surfaced in a real `@payloadcms/plugin-multi-tenant` install. **No breaking changes** — plain single-tenant installs are unaffected.

### Fixed

- **Customer search is now tenant-scoped.** The `/api/reservation-customer-search` endpoint (used by the reservation customer picker) restricts results to the selected tenant — read from the tenant cookie — whenever the customers collection carries the multi-tenant `tenant` field. This prevents picking a customer from another tenant, which would otherwise fail on save with a tenant mismatch. Plain single-tenant installs are unaffected (no tenant field / no cookie ⇒ no scoping).
- **Flexible-duration reservations can be saved from the admin UI.** The reservation `endTime` field was unconditionally read-only, which contradicted the `calculateEndTime` validation that requires a user-supplied `endTime` for `flexible`-duration services. `endTime` is now editable; for `fixed`/`full-day` services it is still auto-computed and overwritten on save.

## [2.1.0] - 2026-06-11

A minor, additive release: per-tenant timezones for the custom admin views in `multiTenant` mode. **No breaking changes** — plain single-tenant installs are byte-for-byte unaffected.

### Added

- **Per-tenant timezones (`multiTenant`).** The admin Calendar, Availability grid, and Dashboard widget now resolve day-boundaries in the **selected tenant's** timezone instead of one global zone, so tenants in different zones each see their own local days. Resolution precedence: `tenant.<timezoneField> → global timezone → 'UTC'`.
- **`multiTenant.timezoneField`** option (default `'timezone'`) — points at the IANA timezone field on your tenant document. A missing or invalid value transparently falls back to the global `timezone`.
- **`GET /api/reserve/effective-timezone`** endpoint — returns the resolved zone for the current request's selected tenant (read from the tenant cookie); the client calendar uses it for day-boundary rendering. Authenticated only.

### Fixed

- **`GET /api/reserve/resource-availability`** now resolves day windows in the selected tenant's zone (was a single global zone for every tenant) and echoes the resolved `timeZone` in its response.

### Notes

- Purely additive: `multiTenant.timezoneField` is optional, and installs with no tenant relationship / no tenant cookie keep the global zone with **no extra DB read**.

## [2.0.0] - 2026-06-10

A correctness, security, and feature release following a full plugin audit. Most changes fix incorrect behavior, but several are **breaking** for specific integration patterns — read the migration notes first. On a UTC server with default configuration, core booking behavior is largely unchanged; the breaking items mainly affect API consumers, custom status vocabularies, partial `access` overrides, and non-UTC-server deployments.

### ⚠️ Breaking changes & migration notes

- **`GET /api/reserve/resource-availability` now requires a staff/admin user.** It previously responded to anyone and leaked every resource's busy calendar. Unauthenticated requests now get `401`, customer-collection users `403`. If you called this endpoint from a public/unauthenticated frontend, it will stop working — call it only from authenticated admin/staff contexts. **Single-collection installs (`userCollection` set) must configure `resourceOwnerMode.adminRoles` and/or `staffProvisioning.staffRoles`**, otherwise every user (including real admins) is treated as a customer and gets `403`.
- **`POST /api/reserve/book` no longer accepts an arbitrary `customer`.** Anonymous callers may not set `customer` (→ `403`; use the guest flow with `guest` details instead); authenticated non-staff users are always booked as themselves; staff/admin may still book for anyone. A caller-supplied `cancellationToken` in the body is now ignored (always server-generated). The same `customer`-mass-assignment guard also applies to Payload's default `POST /api/{reservations}` REST route. Update any client that posted a `customer` id for the current user — it's now inferred from the session.
- **`access` overrides now compose per operation instead of replacing.** A partial override such as `access: { resources: { read } }` previously wiped the owner-mode `create`/`update`/`delete` rules; now it overlays only `read` and keeps the rest. If you relied on a partial override to _remove_ owner-mode rules, specify every operation explicitly.
- **Business timezone defaults to `'UTC'`.** Schedule resolution, day boundaries, exception matching, and the admin calendar now resolve in the configured `timezone`. On a UTC server this matches previous behavior; **on a non-UTC server, day/slot resolution changes to the correct calendar day** (it was previously buggy). Set `timezone` to your business IANA zone (e.g. `'America/New_York'`). The unused `Resource.timezone` field is deprecated.
- **Custom status vocabularies must set `statusMachine.confirmStatus` / `cancelStatus`.** The confirm/cancel plugin hooks, the cancellation notice-period rule, and the `cancellationReason` field now key off these (default `'confirmed'`/`'cancelled'`) instead of hardcoded literals. If you renamed your statuses (e.g. `booked`/`voided`), set `confirmStatus`/`cancelStatus` or that behavior won't fire. Both are validated against `statuses` at init.
- **Conflict detection is stricter and corrected.** Buffer times are now enforced symmetrically against _neighboring_ bookings (the required gap between two bookings on a resource is the later one's `bufferTimeBefore` plus the earlier one's `bufferTimeAfter`), so back-to-back bookings that previously slipped past a cleanup buffer are now rejected. Multi-resource bookings now block each resource only for its own item window (no more whole-span over-blocking). Service buffer fields are capped at 1439 minutes. Expect some bookings that previously passed/failed to flip to the correct outcome.
- **Stricter init-time validation throws on previously-silent misconfig.** A missing `userCollection`, a slug collision, a terminal status with outgoing transitions, a terminal `defaultStatus`, or a `confirmStatus`/`cancelStatus` not in `statuses` now throw a clear error at boot. A previously-broken-but-booting config may now fail fast — fix the config.
- **Lifecycle hooks fire differently.** `beforeBookingCreate` fires once per `/api/reserve/book` booking (was twice — double-charges/double-sends are fixed) and now runs inside the collection `beforeChange` (after field validation), so a hook stamping a _required_ field must read the merged document. `afterStatusChange`/`afterBookingConfirm` no longer fire on plain creates. `beforeBookingCancel` no longer fires when the cancellation is rejected by the notice period. Review integrations that depended on the old firing.
- **Type-only:** `StatusMachineConfig` gained required `confirmStatus`/`cancelStatus`. Config input is `Partial`, so plugin options are unaffected; only code that imported the full type and constructed it by hand needs the two fields.

### Added

- **`timezone` plugin option** (IANA, default `'UTC'`) governing all schedule/day resolution, via the built-in `Intl` API (no new dependency); exposed to admin components as `config.admin.custom.reservationTimezone`.
- **`collectionOverrides` plugin option** — per-collection overrides for the generated collections (`Omit<Partial<CollectionConfig>, 'fields' | 'slug'> & { fields?: ({ defaultFields }) => Field[] }`); resolves [#4](https://github.com/elghaied/payload-reserve/issues/4). The plugin's hooks are merged (always run, first), `access` composes, and `slug` is ignored. Supersedes the deprecated `extraReservationFields`.
- **`statusMachine.confirmStatus` / `cancelStatus`** for custom status vocabularies.
- **`resourceOwnerMode.roleField`** (default `staffProvisioning.roleField` or `'role'`) for admin detection on collections using a custom/array role field.

### Fixed

- **Partial-update validation:** reschedules via the REST/Local API now recompute `endTime` and re-check conflicts against the merged document; benign edits (notes, status out of a blocking status) skip re-validation so they aren't blocked by buffer/schedule changes made after booking. Flexible-duration bookings reject inverted (`endTime ≤ startTime`) windows.
- **Timezone day-resolution:** the slots API and admin calendar/grid no longer resolve the wrong calendar day on non-UTC servers; exceptions and manual slots align across booking API and admin UI.
- **Neighbor buffers, multi-resource over-blocking, and same-booking item conflicts** (see breaking notes); per-guest capacity sums the matched item's `guestCount`; an exception on any of a resource's schedules makes the whole resource unavailable that day, and `date`–`endDate` exception ranges are honored.
- **Endpoint robustness:** non-numeric `guestCount` → `400` (was a silent empty list); unknown/malformed `service`/`resource` ids → `404` (was `500`); impossible calendar dates → `400`.
- **Owner relationship (`ownedServices`)** now targets the resolved owner collection instead of a hardcoded customers slug; **staff provisioning** backfills pre-existing staff and re-creates deleted resources via the dedup-by-owner query.
- **Admin UI data correctness:** month view fetches the full 6-week span it renders; week/day/lane views derive a shared, data-driven visible-hour window; fetches guard against stale responses; the pending badge and dashboard use count queries (no truncation), with a "showing N of M" notice on capped lists; `CustomerField` respects a custom `routes.api`/`serverURL`.

### Changed / Deprecated

- **`disabled`** now keeps the plugin's collections registered (schema-stable — no table-dropping migrations) while making behavior inert.
- **`extraReservationFields`** deprecated in favor of `collectionOverrides.reservations.fields` (still works).
- **`Resource.timezone`** field deprecated (unused) in favor of the plugin-level `timezone`.
- Service/Resource `image` upload fields are added only when a `media` collection exists, so media-less installs no longer hit an init error.

### Internal

- Dev harness: disabled Payload's fire-and-forget `generate:types` child in all test configs (it leaked one orphaned process per boot and pinned the CPU).

## [1.6.0] - 2026-06-09

Makes the plugin's custom Reservations admin views multi-tenant aware. Additive minor release — with no `multiTenant` option set and no tenant field on the collections, behavior is unchanged.

### Fixed

- **Cross-tenant data leak in the custom admin views.** The plugin replaces the built-in Reservations list view with a custom calendar and fetches its own data (REST in the client views, Local API in the dashboard widget), so `@payloadcms/plugin-multi-tenant`'s list-view `baseFilter` never applied — a super-admin with a single tenant selected saw **every** tenant's reservations, resources, and schedules. The calendar, pending count/list, availability grid, and dashboard widget now scope to the selected tenant (read from the `payload-tenant` cookie).

### Added

- **`multiTenant` plugin option** — opt-in tenant scoping for the custom admin views: `{ tenantField?: string (default 'tenant'); cookieName?: string (default 'payload-tenant') }`. Auto-detected at runtime: scoping is applied only when the scoped collection (resources, schedules, reservations) actually has the tenant field **and** the tenant cookie is set, so plain single-tenant installs are byte-for-byte unchanged. No peer dependency on `@payloadcms/plugin-multi-tenant` (it is detected, not required).

## [1.5.0] - 2026-06-02

A large feature release: multi-resource availability, staff scheduling & auto-provisioning, an availability-aware calendar, guest (account-less) bookings, and full admin-UI internationalization. The plugin's public API and config surface remain **additive** — with no new options set, behavior is unchanged — so this is a minor release. However, there are behavioral and database-migration notes existing deployments should review before upgrading.

### ⚠️ Breaking changes & migration notes

- **Multi-resource conflict detection corrected (behavioral).** Conflict detection previously counted only a reservation's top-level `resource` and ignored resources held in `items[]`. It now also counts `items.resource`, and multi-resource bookings receive a top-level `[startTime, endTime]` span. **Existing multi-resource deployments will start correctly rejecting bookings that previously slipped through as silent double-bookings.** Single-resource deployments are unaffected.
- **`Reservation.customer` is now optional.** To support guest bookings, the `customer` relationship is no longer required at the schema level — a reservation must have **either** a `customer` **or** a `guest`. On Postgres the `customer` column becomes nullable.
- **Resource `owner` collection changed for separate users/customers setups.** With `resourceOwnerMode` and **separate** `users`/`customers` collections, the `owner` relationship now points at `resourceOwnerMode.ownerCollection ?? staffProvisioning.userCollection ?? slugs.customers` instead of always `customers`. If you relied on the previous (incorrect) `customers` target, set `resourceOwnerMode.ownerCollection: 'customers'` explicitly. Single-collection / customer-owned setups are unchanged.
- **Postgres migrations required** for the new fields: `Service.requiredResources`, `Resource.resourceType`, `Schedule.exceptions.endDate` / `exceptions.type`, the reservation `guest` group + `cancellationToken`, the `items` array, and the now-nullable `customer` (plus the `owner` relationship target change above). **MongoDB needs no migration.**
- **`resourceType` default.** New Resources default `resourceType` to the first entry of `resourceTypes` (`'staff'` by default).

### Added

- **Multi-resource availability.** A service can declare `requiredResources` (e.g. a shared chair pool) that every booking of it occupies. Slot discovery (`getAvailableSlots`, `/api/reserve/slots`, `/api/reserve/availability`) intersects the schedules and capacity of all required resources, and bookings are auto-expanded into `items[]` so conflict detection blocks a booking when any required pool is full. Adds a descriptive `resourceType` field to Resources.
- **Staff scheduling & auto-provisioning.** Opt-in `staffProvisioning` (requires `resourceOwnerMode`) auto-creates owner-scoped Resources from staff-role users, assigning ownership securely by impersonating the new staff user (no ownership-bypass flag). Adds full-day-range typed time-off on `Schedule.exceptions` (`endDate` + `type`) and configurable `resourceTypes` / `leaveTypes` vocabularies. `Resource.services` is now optional so freshly provisioned staff resources can exist before services are assigned.
- **Availability-aware calendar & booking.** The reservation `startTime` field is now a slot picker that only offers free times for the chosen service + staff. The admin calendar's week/day views shade off-shift, time-off, and fully-booked slots when a resource is selected, show capacity (`n/quantity`), render time-off bands, and support click-to-book. Adds a resource-lane horizontal-timeline day view and multi-resource event badges, backed by a new read-only `/api/reserve/resource-availability` endpoint and a pure, tested `computeSlotStates` utility.
- **Guest (account-less) bookings.** New `allowGuestBooking` plugin option (default `false`) plus a per-service tri-state override (`inherit` / `enabled` / `disabled`). Reservations may carry inline `guest` contact details (name + email/phone) instead of a `customer`. Guest bookings receive a `cancellationToken` exposed via the `afterBookingCreate` hook so the host can deliver an email link or SMS code; `/api/reserve/cancel` accepts `{ reservationId, token }` for unauthenticated guests. The plugin performs no email/SMS delivery itself.
- **Internationalization.** Every admin string is now translatable, with 11 new bundled locales — French (`fr`), German (`de`), Spanish (`es`), Russian (`ru`), Polish (`pl`), Turkish (`tr`), Arabic (`ar`), Simplified Chinese (`zh`), Indonesian (`id`), Hindi (`hi`), and Persian/Farsi (`fa`) — each with full key parity with English. Translations merge into Payload's `i18n` config and host-provided translations take precedence. All locales except Hindi ship in Payload core and appear in the admin language switcher automatically; `hi` must be registered as a custom language by the host.

### Fixed

- **Silent double-bookings in multi-resource deployments** — conflict detection now counts `items.resource` (see Breaking changes above).
- **Resource `owner` pointed at the wrong collection** in `resourceOwnerMode` with separate `users`/`customers` collections — it was hardcoded to `customers`. Now relates to `resourceOwnerMode.ownerCollection ?? staffProvisioning.userCollection ?? customers`, and adds an optional `resourceOwnerMode.ownerCollection` to override explicitly.
- **Staff/admin detection in single-collection (`userCollection`) deployments.** When customers and staff share one auth collection, the previous `req.user.collection === slugs.customers` check could never identify staff. A new role-aware check (collection first, then `resourceOwnerMode.adminRoles ∪ staffProvisioning.staffRoles`) fixes creating non-default-status reservations (e.g. `confirmed`) as staff/admin, the customer-search endpoint returning 403 to staff, and cancellation permission for staff/admin. Customer search also now excludes privileged-role users from results in single-collection mode. Two-collection deployments are unaffected.

## [1.4.0] - 2026-05-22

### Fixed

- **Postgres reservations now create successfully.** The internal `extractId` helper in `resolveReservationItems.ts` did not handle numeric IDs, so on the Postgres adapter every reservation create failed: `extractId(42)` returned `undefined`, causing `validateConflicts` to call `findByID({ id: '' })` and throw `NotFound` before any conflict check could run. Adds a numeric branch to `extractId`, and widens `ResolvedItem.resource` / `ResolvedItem.service` plus the `resourceId` / `excludeReservationId` / `serviceId` parameters in `AvailabilityService` to `number | string`. MongoDB behaviour is unchanged.

### Changed

- **Restored the documented `name` field on the extended user collection.** README, SKILL, and the v1.0.0 release notes all describe `userCollection`-mode as injecting `name`, `phone`, `notes`, and `bookings`, but the field injection in `plugin.ts` only added the last three. A downstream project that set `admin.useAsTitle: 'name'` on its extended user collection was blocked because no `name` field existed. The plugin now injects `name` (text, max 200, required) along with the other three. Collections that already define their own `name` field are unaffected — field deduplication preserves the original definition.

  Treated as a minor (rather than patch) bump because this restores documented behaviour by introducing a new required field on `userCollection`-extended collections that did not previously define their own `name`.

## [1.3.2] - 2026-03-14

### Fixed

- Fix hyphenated status names (e.g. "no-show") not resolving to correct i18n translation keys. Extracted shared `statusToI18nKey` utility used by both Reservations collection and CalendarView.
- Fix changelog extraction in GitHub Actions release workflow to handle both bracketed and unbracketed version headers.
- Fix `ComponentPath` → `Component` property name for dashboard widget (Payload Widget type compatibility).

## [1.3.0] - 2026-03-10

### Minor Changes

- Add resource filter dropdown to CalendarView allowing users to filter reservations by resource, with translation support and pending badge integration

## [1.2.0] - 2026-03-09

### Breaking changes

- **Cancel endpoint enforces ownership** — only the reservation's customer or admin/staff can cancel. Non-owners receive 403.
- **Customer search restricted to admin/staff** — `GET /api/reserve/customers` returns 403 for customer-collection users.
- **`beforeBookingConfirm`/`beforeBookingCancel` hooks receive merged doc** — hooks now see `{ ...originalDoc, ...data }` instead of just `originalDoc`.
- **After-status-change hooks no longer throw** — errors are caught and logged via `req.payload.logger.error`.
- **Conflict error paths changed for multi-resource bookings** — errors use `items.N.startTime` instead of `startTime`.
- **Incomplete multi-resource items throw instead of being silently dropped** — items missing `resource` or `startTime` throw a `ValidationError`.
- **Slot generation returns more slots** — step size changed to `Math.min(serviceDuration, 15)` minutes.

### Fixed

- Fix admin detection to work with non-default admin collection slugs.
- Pass `guestCount` through to slot availability checks for correct `per-guest` capacity filtering.
- Full-day services now return proper single slots per schedule range.
- Invalid dates on `/api/reserve/availability` return 400 instead of silently failing.
- Schedule time fields validate `HH:mm` format and enforce `endTime > startTime`.
- Duplicate `(resource, startTime)` pairs in multi-resource bookings are rejected.
- Status machine config is validated at init time — invalid configs throw immediately.
- Per-item buffer time resolution — each item's own service determines its buffer times.

## [1.1.0] - 2026-02-22

### Added

- **Resource ownership** — Resources can now be owned by a user (customer). Useful for use cases where customers publish and manage their own services/resources

### Fixed

- Owner access control issues when a user owned a resource

## [1.0.3] - 2026-02-21

### Added

- **Multi-resource bookings** — A single reservation can now span multiple resources simultaneously via the `items` array field. Each item carries its own `resource`, `service`, `startTime`, and `endTime`, with backwards-compatible fallback to top-level fields
- **Configurable status machine** — Full `StatusMachineConfig` with `statuses`, `transitions`, `blockingStatuses`, `defaultStatus`, and `terminalStatuses`. Partially override defaults via the `statusMachine` plugin option
- **Plugin hooks API** — Seven lifecycle hooks (`beforeBookingCreate`, `afterBookingCreate`, `beforeBookingConfirm`, `afterBookingConfirm`, `beforeBookingCancel`, `afterBookingCancel`, `afterStatusChange`) for integrating email, payments, and external systems
- **Availability service** — `AvailabilityService.ts` with pure functions (`computeEndTime`, `buildOverlapQuery`, `isBlockingStatus`, `validateTransition`) and DB functions (`checkAvailability`, `getAvailableSlots`)
- **Three duration types** — `fixed` (service duration), `flexible` (customer-specified end), and `full-day` bookings via `durationType` field on Services
- **Capacity and inventory** — `quantity` and `capacityMode` (`per-reservation` | `per-guest`) fields on Resources; `guestCount` on Reservations
- **Idempotency** — `idempotencyKey` field on Reservations with `checkIdempotency` hook to reject duplicate submissions
- **Standalone Customers collection** — When `userCollection` is `undefined` (default), the plugin creates a dedicated Customers collection instead of extending the `users` collection
- **`onStatusChange` hook** — Detects status changes after save and fires `afterStatusChange`, `afterBookingConfirm`, `afterBookingCancel` lifecycle hooks
- **Five public endpoints** — `GET /api/reserve/availability`, `GET /api/reserve/slots`, `POST /api/reserve/book`, `POST /api/reserve/cancel`, `GET /api/reserve/customers`
- **`resolveReservationItems` utility** — Normalizes single and multi-resource reservation data into a unified `ResolvedItem[]` for all downstream logic
- **`@payloadcms/translations` and `@payloadcms/ui` peer dependencies** — Added to `peerDependencies` for proper version alignment
- **Docs** — Full documentation split into 11 topic files under `docs/`

### Changed

- **User collection extension** — `userCollection` now defaults to `undefined` (creates standalone Customers). Set to an existing auth collection slug to extend it instead
- **Conflict detection** — `validateConflicts` hook now operates on `resolvedItems[]` and respects `capacityMode` and `quantity`
- **`calculateEndTime`** — Reworked to handle all three `DurationType` variants
- **Enhanced Calendar view** — Rebuilt with CSS modules (`CalendarView.module.css`) and improved layout

### Fixed

- Translation merging issue where plugin translations would not properly register
- Casting issue in collections causing type errors at runtime
- `@payloadcms/translations` and `@payloadcms/ui` missing from declared peer dependencies

## [1.0.2] - 2026-02-15

### Added

- **Image field on Services** — services can now have an image (upload field)
- **Validate and cancel view** — custom admin view to validate or cancel pending reservations directly from the admin UI

### Changed

- **Customer collection** — moved customer management to a dedicated collection (previously always extended the `users` collection)

### Fixed

- Lint errors

## [1.0.1] - 2026-02-14

### Changed

- **Renamed plugin export** from `reservationPlugin` to `payloadReserve` for consistency with the package name
- **Simplified default collection slugs** — `reservation-services`, `reservation-resources`, and `reservation-schedules` are now just `services`, `resources`, and `schedules` to reduce verbosity
- **Customer role filtering is now optional** — `customerRole` defaults to `false` (show all users) instead of requiring a role. Set to a role string (e.g., `'customer'`) to filter

### Added

- **Customer Picker field** — new rich customer search component replacing the default relationship dropdown on Reservations. Features multi-field search (name, phone, email), inline create/edit via document drawer, and optional role filtering via the `customerRole` config option
- **Image field on Resources** — resources can now have an image (upload field) for displaying photos of staff, rooms, or equipment. Configurable via `slugs.media` (default: `'media'`)
- **`slugs.media` config option** — configurable slug for the media collection used by the Resources image field (default: `'media'`)
- **Claude Code skills** — added skill definitions for AI-assisted development with the plugin

### Fixed

- Excluded E2E spec files from Vitest test runs
- Synced package versions and lockfile
- Specified pnpm version in CI workflow
- Switched to OIDC for npm publishing in CI

## [1.0.0] - 2025-06-01

### Added

#### Collections

- **Services** collection with fields: `name`, `description`, `duration`, `price`, `bufferTimeBefore`, `bufferTimeAfter`, `active`
- **Resources** collection with fields: `name`, `description`, `services` (many-to-many relationship), `active`
- **Schedules** collection with two schedule types:
  - Recurring slots: day-of-week + start/end time
  - Manual slots: specific date + start/end time
  - Exception dates with optional reason
- **Reservations** collection with fields: `service`, `resource`, `customer`, `startTime`, `endTime` (auto-calculated), `status`, `cancellationReason`, `notes`
- **User collection extension**: adds `name`, `phone`, `notes`, and `bookings` (join) fields to an existing auth collection (configurable via `userCollection` option, default: `users`). Fields are only added if they don't already exist

#### Business Logic Hooks

- **calculateEndTime** hook: auto-computes `endTime` from `startTime` + service duration
- **validateConflicts** hook: prevents double-booking by checking time overlap with buffer windows for the same resource; excludes cancelled/no-show reservations
- **validateStatusTransition** hook: enforces a state machine (pending -> confirmed -> completed/cancelled/no-show); admins can create reservations as confirmed, non-admins start as pending
- **validateCancellation** hook: enforces a configurable minimum notice period (default: 24 hours) before cancellation is allowed
- All hooks respect `context.skipReservationHooks` flag as an escape hatch

#### Admin Components

- **CalendarView** (client component): replaces the default Reservations list view with a month/week/day calendar
  - Status-based color coding for all 5 reservation states
  - Click events to open reservation documents in a drawer
  - Click date/time slots to pre-populate `startTime` when creating new reservations
  - Current time indicator line on week/day views
  - Navigation: previous/next, today button, date range display
  - Keyboard accessible (Enter/Space)
- **DashboardWidgetServer** (RSC): dashboard widget showing today's reservation stats
  - 4 metric cards: total, upcoming, completed, cancelled
  - Next upcoming appointment display
- **AvailabilityOverview** (client component): weekly resource availability grid at `/reservation-availability`
  - Resource rows x day columns
  - Resolves recurring and manual schedules
  - Shows exception dates with reasons
  - Displays booked time slots
  - Color-coded: available (blue), exception (red), booked (gray)

#### Configuration

- Configurable collection slugs (`services`, `resources`, `schedules`, `reservations`)
- Per-collection access control overrides
- Configurable admin group name (default: `Reservations`)
- `defaultBufferTime` option: fallback buffer minutes between reservations (default: 0)
- `cancellationNoticePeriod` option: required notice hours for cancellation (default: 24)
- `userCollection` option: slug of the auth collection to extend (default: `users`)
- `disabled` option to bypass the plugin entirely

#### Internationalization

- Full i18n support with 86 translation keys covering collection labels, field labels, status names, day names, error messages, calendar UI, dashboard, and availability grid
- English translations built-in
- Plugin translations merge with user translations (user translations take precedence)
- Auto-detect Payload localization config and set `localized: true` on `name`/`description` fields in Services and Resources collections

#### Utilities

- `slotUtils`: `addMinutes`, `doRangesOverlap`, `computeBlockedWindow`, `hoursUntil`
- `scheduleUtils`: `resolveScheduleForDate`, `getDayOfWeek`, `dateMatchesDay`, `parseTime`, `combineDateAndTime`, `isExceptionDate`

#### Exports

- `.` (main): `payloadReserve` function + types
- `./client`: `CalendarView`, `AvailabilityOverview` client components
- `./rsc`: `DashboardWidgetServer` React Server Component

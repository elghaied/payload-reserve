# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

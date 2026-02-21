# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

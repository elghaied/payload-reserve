# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

- `.` (main): `reservationPlugin` function + types
- `./client`: `CalendarView`, `AvailabilityOverview` client components
- `./rsc`: `DashboardWidgetServer` React Server Component

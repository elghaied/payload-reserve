# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

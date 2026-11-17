# Development

Guide for contributors and local development of the plugin itself.

## Prerequisites

- Node.js `^24.22.3` or `>=26.13.1` (Payload 4)
- pnpm `^9` or `^10`

## Commands

```bash
pnpm dev                    # Start dev server (needs DATABASE_URL pointing at a MongoDB replica set)
pnpm build                  # Build for distribution
pnpm test:int               # Run integration tests (Vitest)
pnpm test:e2e               # Run E2E tests (Playwright, requires dev server)
pnpm test                   # Both test suites
pnpm lint                   # ESLint check
pnpm lint:fix               # ESLint auto-fix
pnpm dev:generate-types     # Regenerate payload-types.ts after schema changes
pnpm dev:generate-importmap # Regenerate import map after adding components
```

Run a single test by pattern: `pnpm vitest -t "conflict detection"`

`pnpm test:int` runs two Vitest projects, configured in `vitest.config.js`: `integration` (Node,
MongoDB Memory Server, `dev/*.spec.ts`) and `components` (jsdom, no database — renders admin
components in isolation, `dev/components/**/*.spec.{ts,tsx}`).

## Opt-in Dev Harnesses

Two dev-app behaviours are gated behind environment variables that are unset (and therefore change nothing) by default:

- **`MT=1`** — boots the dev app with `@payloadcms/plugin-multi-tenant` wired in (two tenants, a super-admin dev user), for manually verifying tenant-scoped admin views: `MT=1 pnpm dev:generate-importmap && MT=1 pnpm dev`.
- **`RESERVE_DETAIL_SLOT=1`** — wires `dev/components/ReservationDetailFixture.tsx` into `components.reservationDetail` (see `dev/payload.config.ts`), so the e2e suite can assert that a consumer-supplied `reservationDetail` component really renders in place of the plugin's own drawer body. Boot it the same way: `RESERVE_DETAIL_SLOT=1 pnpm dev:generate-importmap && RESERVE_DETAIL_SLOT=1 pnpm dev`.

### The committed import map is stable regardless of the gate

`dev/app/(payload)/admin/importMap.js` is checked into the repo. It used to be a **gated superset**: the fixture component's import-map entry only came from `payloadReserve()`'s own `components.reservationDetail` option, which only names the fixture when `RESERVE_DETAIL_SLOT=1` is set — so a plain `pnpm dev:generate-importmap` (gate unset) silently regenerated the file without that entry, breaking the gated e2e test with no error at generation time.

That was fixed (`dev/payload.config.ts`'s `admin.dependencies`) by registering the fixture's import **unconditionally**, independent of the gate — the same mechanism `payloadReserve()` itself uses for its own components. `RESERVE_DETAIL_SLOT` now only controls whether the admin UI actually *points* the `reservationDetail` slot at the fixture; it no longer controls whether the import map *knows about* it. Regenerating with the gate either set or unset produces a byte-identical `importMap.js` — verified directly against the real CLI.

You can still regenerate the map whenever you like; there's no ceremony required:

```bash
pnpm dev:generate-importmap
```

To actually exercise the fixture — this gate is still live, it's what wires `components.reservationDetail` to `ReservationDetailFixture.tsx` — run the gated e2e test:

```bash
RESERVE_DETAIL_SLOT=1 pnpm dev:generate-importmap
RESERVE_DETAIL_SLOT=1 DATABASE_URL=... pnpm dev
RESERVE_DETAIL_SLOT=1 DATABASE_URL=... pnpm test:e2e --workers=1 -g "consumer-supplied"
```

## Project Structure

```
src/
  index.ts              # Public API: re-exports plugin + types
  plugin.ts             # Main plugin factory function
  types.ts              # All TypeScript types + DEFAULT_STATUS_MACHINE
  defaults.ts           # Default config values + resolveConfig()

  collections/
    Services.ts         # Services (duration, durationType, requiredResources, allowGuestBooking, buffers, owner)
    Resources.ts        # Resources (quantity, capacityMode, timezone, resourceType, owner)
    Schedules.ts        # Availability schedules (recurring/manual + exceptions w/ endDate + leave type)
    Reservations.ts     # Bookings (hooks, guest, cancellationToken, guestCount, items, idempotencyKey)
    Customers.ts        # Standalone customer auth collection
    Holds.ts            # reservation-holds (only when slotHolds is enabled)

  hooks/
    index.ts                    # Barrel export (the hooks are wired in collections/Reservations.ts)
    reservations/
      enforceCustomerOwnership.ts # A customer can only book for themselves
      checkIdempotency.ts       # Duplicate submission prevention
      validateGuestBooking.ts   # Guest vs customer validation + cancellation token
      expandRequiredResources.ts # Auto-expand service.requiredResources into items[]
      validateActive.ts         # Rejects inactive services/resources
      calculateEndTime.ts       # Auto end time from service duration
      validateBookingWindow.ts  # Public callers: no past starts, inside the schedule, item cap
      acquireBookingLock.ts     # Serializes simultaneous bookers per resource
      validateConflicts.ts      # Double-booking prevention (per item)
      validateStatusTransition.ts # Status machine enforcement
      validateCancellation.ts   # Cancellation notice period
      onStatusChange.ts         # afterChange — fires plugin hook callbacks
    holds/
      validateHoldSlot.ts       # Slot-hold validation
    shared/
      preventDeleteWhenReferenced.ts # Delete guard for Services/Resources
    users/
      provisionStaffResource.ts # afterChange — auto-provision Resource for staff users

  services/
    AvailabilityService.ts    # computeEndTime, checkAvailability, getAvailableSlots, ...
    HoldService.ts            # takeHold, releaseHold
    index.ts                  # Barrel re-export of availability functions

  endpoints/
    checkAvailability.ts      # GET /api/reserve/availability
    getSlots.ts               # GET /api/reserve/slots
    resourceAvailability.ts   # GET /api/reserve/resource-availability (calendar shading)
    createBooking.ts          # POST /api/reserve/book
    cancelBooking.ts          # POST /api/reserve/cancel
    customerSearch.ts         # GET /api/reservation-customer-search
    effectiveTimezone.ts      # GET /api/reserve/effective-timezone
    holdSlot.ts               # POST /api/reserve/hold (slotHolds)
    releaseSlot.ts            # POST /api/reserve/hold/release (slotHolds)
    heldSlots.ts              # GET /api/reserve/held (slotHolds; admin availability grid)

  utilities/
    slotUtils.ts              # addMinutes, doRangesOverlap, computeBlockedWindow, hoursUntil, localDayKey
    scheduleUtils.ts          # resolveScheduleForDate, combineDateAndTime, etc.
    resolveReservationItems.ts # Normalizes reservation data into ResolvedItem[]
    resolveRequiredResources.ts # Merge primary + required resource ids
    computeSlotStates.ts      # Derive slot states (free/full/off-shift/time-off) for the calendar
    guestBooking.ts           # resolveGuestBookingAllowed — per-service guest tri-state
    selectOptions.ts          # buildSelectOptions — string[] -> Payload select options
    userRoles.ts              # isPrivilegedUser — role-aware staff/admin detection
    ownerAccess.ts            # Access helpers for resource-owner mode
    i18nUtils.ts              # Translation helpers

  translations/
    index.ts                  # Locale registry + PluginTranslationKeys / PluginT types
    en.json, ar.json, de.json, es.json, fa.json, fr.json,
    hi.json, id.json, pl.json, ru.json, tr.json, zh.json  # 12 bundled locales

  components/
    CalendarView/             # Client: month/week/day/lanes/pending calendar
      LaneTimelineView.tsx    #   per-resource lane timeline
      useResourceAvailability.ts #   hook fetching resource availability
    AvailabilityTimeField/    # Client: availability-aware startTime slot picker
    CustomerField/            # Client: rich customer search field
    DashboardWidget/          # RSC: today's reservation stats
    AvailabilityOverview/     # Client: weekly resource grid

  exports/
    client.ts                 # Calendar, fields, detail drawer, primitives, hooks, formatters
    rsc.ts                    # CalendarViewServer, DashboardWidgetServer
    sdk.ts                    # Frontend client (payload-reserve/sdk) — no Payload/React imports

dev/
  payload.config.ts           # Dev Payload config (MongoDB Memory Server)
  seed.ts                     # Sample salon data
  int.spec.ts                 # Vitest integration tests
  e2e.spec.ts                 # Playwright E2E tests
  components/                 # jsdom component tests (vitest "components" project)
```

## Key Conventions

- **ESM throughout** — `"type": "module"` in package.json. Use `.js` extensions in import paths even for TypeScript files.
- **Prettier** — single quotes, no semicolons, trailing commas, 100-char line width.
- **TypeScript strict mode** — types-only emit via `tsc`; actual transpilation via SWC.
- **Peer dependencies** — all peer dependencies (payload, react, next) are devDependencies — peer dependencies are `payload`, `@payloadcms/ui`, `@payloadcms/translations` `^4.0.0-beta.9` on `next` (`^3.86.0` on `main`).
- **Object property ordering** — alphabetically ordered (enforced by `perfectionist/sort-objects`). Note: `id` is treated as a top group and sorts before all other keys.

---

## Running the test suite against every adapter

The integration suite defaults to an in-memory MongoDB replica set. Run it against Postgres or SQLite with an env var — no code changes needed:

```bash
# Postgres — point PG_URL at a real, empty database
PG_URL="postgres://user:password@localhost:5432/reserve_test" CI=true pnpm test:int

# SQLite — in-memory by default
SQLITE=1 CI=true pnpm test:int
```

Both are opt-in dev/CI conveniences, not something a consumer's app needs to configure — they exist so this plugin's own suite can be verified against every adapter it claims to support. **Neither run is expected to be fully green by construction, and this is known, not a regression to chase.** Last measured on Payload 4.0.0-beta.9 (70 files, 829 tests):

| Run | Result | The gaps |
|---|---|---|
| MongoDB (default) | 829 passed, 0 skipped | none |
| `PG_URL=…` | 828 passed, 1 skipped | the `bufferFor error trace` skip below |
| `SQLITE=1` | 825 passed, 3 failed, 1 skipped | the same `bufferFor` skip, plus **3 failures that are all one accepted upstream limitation**: `dev/concurrency.int.spec.ts`'s `quantity: 3` capacity recovery, `dev/holds.int.spec.ts`'s `quantity: 3` capacity recovery, and `dev/bookingRetry.int.spec.ts`'s no-500 assertion. All three trace to `@payloadcms/drizzle` discarding the driver's structured error code at `beginTransaction` (see [Concurrent Bookings](./concurrency.md)) — never "fix" any of them by matching on message text. |

The `bufferFor error trace` skip manufactures a dangling reference via `context.skipReservationHooks` to exercise a code path that the delete guard makes structurally unreachable on a schema-enforced SQL database, so the scenario is MongoDB-only by construction.

---

## Contributing and Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

When making a change that should appear in the release notes, run:

```bash
pnpm changeset
```

This prompts for the semver bump type (patch/minor/major) and a summary. Commit the generated changeset file with your PR.

**Releasing:**

```bash
pnpm changeset:version   # consume changesets, bump version, update CHANGELOG.md
# then fix the new CHANGELOG heading to `## [X.Y.Z] - YYYY-MM-DD` (the release workflow extracts it)
git add -A && git commit -m "chore: release v<version>"
git tag v<version>
git push && git push --tags
```

The GitHub Action will create a release with the changelog content and publish to npm.

---

← [Advanced](./advanced.md) | ↑ [Back to README](../README.md)

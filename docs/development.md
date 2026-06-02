# Development

Guide for contributors and local development of the plugin itself.

## Prerequisites

- Node.js `^18.20.2` or `>=20.9.0`
- pnpm `^9` or `^10`

## Commands

```bash
pnpm dev                    # Start dev server (Next.js + in-memory MongoDB)
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

  hooks/
    index.ts                    # Wires reservation hooks onto the collection
    reservations/
      checkIdempotency.ts       # Duplicate submission prevention
      validateGuestBooking.ts   # Guest vs customer validation + cancellation token
      expandRequiredResources.ts # Auto-expand service.requiredResources into items[]
      calculateEndTime.ts       # Auto end time from service duration
      validateConflicts.ts      # Double-booking prevention (per item)
      validateStatusTransition.ts # Status machine enforcement
      validateCancellation.ts   # Cancellation notice period
      onStatusChange.ts         # afterChange — fires plugin hook callbacks
    users/
      provisionStaffResource.ts # afterChange — auto-provision Resource for staff users

  services/
    AvailabilityService.ts    # computeEndTime, checkAvailability, getAvailableSlots, ...
    index.ts                  # Barrel re-export of availability functions

  endpoints/
    checkAvailability.ts      # GET /api/reserve/availability
    getSlots.ts               # GET /api/reserve/slots
    resourceAvailability.ts   # GET /api/reserve/resource-availability (calendar shading)
    createBooking.ts          # POST /api/reserve/book
    cancelBooking.ts          # POST /api/reserve/cancel
    customerSearch.ts         # GET /api/reservation-customer-search

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
    client.ts                 # CalendarView, AvailabilityOverview, CustomerField, AvailabilityTimeField
    rsc.ts                    # DashboardWidgetServer

dev/
  payload.config.ts           # Dev Payload config (MongoDB Memory Server)
  seed.ts                     # Sample salon data
  int.spec.ts                 # Vitest integration tests
  e2e.spec.ts                 # Playwright E2E tests
```

## Key Conventions

- **ESM throughout** — `"type": "module"` in package.json. Use `.js` extensions in import paths even for TypeScript files.
- **Prettier** — single quotes, no semicolons, trailing commas, 100-char line width.
- **TypeScript strict mode** — types-only emit via `tsc`; actual transpilation via SWC.
- **Peer dependencies** — all peer dependencies (payload, react, next) are devDependencies — peer dependencies are `payload ^3.79.0`, `@payloadcms/ui ^3.79.0`, `@payloadcms/translations ^3.79.0`.
- **Object property ordering** — alphabetically ordered (enforced by `perfectionist/sort-objects`). Note: `id` is treated as a top group and sorts before all other keys.

---

← [Advanced](./advanced.md) | ↑ [Back to README](../README.md)

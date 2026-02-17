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
    Services.ts         # Service definitions (name, duration, durationType, price, buffers)
    Resources.ts        # Resources (quantity, capacityMode, timezone)
    Schedules.ts        # Availability schedules (recurring/manual + exceptions)
    Reservations.ts     # Bookings with hooks, guestCount, items, idempotencyKey
    Customers.ts        # Standalone customer auth collection

  hooks/reservations/
    checkIdempotency.ts       # Duplicate submission prevention
    calculateEndTime.ts       # Auto end time from service duration
    validateConflicts.ts      # Double-booking prevention
    validateStatusTransition.ts # Status machine enforcement
    validateCancellation.ts   # Cancellation notice period
    onStatusChange.ts         # afterChange hook — fires plugin hook callbacks

  services/
    AvailabilityService.ts    # computeEndTime, checkAvailability, getAvailableSlots

  endpoints/
    checkAvailability.ts      # GET /api/reserve/availability
    getSlots.ts               # GET /api/reserve/slots
    createBooking.ts          # POST /api/reserve/book
    cancelBooking.ts          # POST /api/reserve/cancel
    customerSearch.ts         # GET /api/reserve/customers

  utilities/
    slotUtils.ts              # addMinutes, doRangesOverlap, computeBlockedWindow, hoursUntil
    scheduleUtils.ts          # resolveScheduleForDate, combineDateAndTime, etc.
    resolveReservationItems.ts # Normalizes reservation data into ResolvedItem[]

  components/
    CalendarView/             # Client: month/week/day calendar
    CustomerField/            # Client: rich customer search field
    DashboardWidget/          # RSC: today's reservation stats
    AvailabilityOverview/     # Client: weekly resource grid

  exports/
    client.ts                 # CalendarView, AvailabilityOverview, CustomerField
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
- **Peer dependencies** — all peer dependencies (payload, react, next) are devDependencies — only `payload ^3.37.0` is a peerDependency.
- **Object property ordering** — alphabetically ordered (enforced by `perfectionist/sort-objects`). Note: `id` is treated as a top group and sorts before all other keys.

---

← [Advanced](./advanced.md) | ↑ [Back to README](../README.md)

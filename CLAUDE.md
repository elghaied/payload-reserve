# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Payload CMS 3.x plugin that adds a reservation/booking system (5 collections, 4 hooks, 3 admin components). Designed for businesses needing appointment scheduling with conflict detection, status workflows, and admin UI.

## Commands

```bash
pnpm dev                  # Next.js dev server (uses dev/ directory with MongoDB Memory Server)
pnpm build                # Full build: copyfiles → types → SWC transpile to dist/
pnpm test:int             # Integration tests (vitest, runs against in-memory MongoDB)
pnpm test:e2e             # E2E tests (playwright, needs dev server running)
pnpm test                 # Both: integration then E2E
pnpm lint                 # ESLint check
pnpm lint:fix             # ESLint auto-fix
pnpm dev:generate-types   # Regenerate payload-types.ts after collection changes
pnpm dev:generate-importmap  # Regenerate import map after adding admin components
```

Running a single integration test: `pnpm vitest -t "test name pattern"`

## Architecture

### Plugin Pattern

The plugin uses Payload's higher-order function pattern: `(pluginOptions) => (config) => modifiedConfig`. Entry point is `src/plugin.ts` which injects 5 collections and 3 admin components into the Payload config.

### Three Export Paths

- `.` (`src/index.ts`) — server-side plugin function and types
- `./client` (`src/exports/client.ts`) — client components (CalendarView, AvailabilityOverview)
- `./rsc` (`src/exports/rsc.ts`) — React Server Components (DashboardWidgetServer)

### Collection Factory Pattern

Each collection in `src/collections/` is a factory function: `createXxxCollection(resolvedConfig) → CollectionConfig`. The resolved config provides customized slugs, access control, and plugin settings. All 5 collections are grouped under a configurable admin group.

**Collections:** Services → Resources → Schedules → Customers → Reservations. Resources reference Services (many-to-many). Schedules belong to Resources. Reservations reference a Service, Resource, and Customer.

### Business Logic Hooks (`src/hooks/reservations/`)

All reservation hooks are `beforeChange` hooks on the Reservations collection:
1. **calculateEndTime** — auto-computes `endTime` from `startTime + service.duration`
2. **validateConflicts** — prevents double-booking (checks overlap with buffer times for same resource)
3. **validateStatusTransition** — enforces state machine: pending → confirmed → completed/cancelled/no-show (defined in `src/types.ts` as `VALID_STATUS_TRANSITIONS`)
4. **validateCancellation** — enforces minimum notice period before cancellation

All hooks respect `context.skipReservationHooks` flag as an escape hatch.

### Admin Components (`src/components/`)

- **DashboardWidgetServer** (RSC) — today's reservation stats, registered as `beforeDashboard`
- **CalendarView** (Client) — month/week/day calendar replacing default Reservations list view
- **AvailabilityOverview** (Client) — weekly resource availability grid at `/reservation-availability`

Components access collection slugs via `config.admin.custom.reservationSlugs`.

### Utilities (`src/utilities/`)

- **slotUtils.ts** — time math: `addMinutes`, `doRangesOverlap`, `computeBlockedWindow`, `hoursUntil`
- **scheduleUtils.ts** — schedule resolution: `resolveScheduleForDate` handles recurring/manual slots and exception dates

### Dev Environment (`dev/`)

- `dev/payload.config.ts` — dev Payload config using MongoDB Memory Server
- `dev/seed.ts` — seeds sample salon data (services, resources, schedules, customers, reservations)
- `dev/int.spec.ts` — vitest integration tests
- `dev/e2e.spec.ts` — playwright E2E tests

## Key Conventions

- ESM throughout (`"type": "module"` in package.json). Use `.js` extensions in import paths even for TypeScript files.
- Prettier: single quotes, no semicolons, trailing commas, 100-char line width.
- TypeScript strict mode. Types-only emit via `tsc`; actual transpilation via SWC.
- All peer dependencies (payload, react, next) are devDependencies — only `payload ^3.37.0` is a peerDependency.


## Documentation 
@documentation/docs.md 

# Reservation Plugin - Implementation Plan

## Context

Building a reusable Payload CMS 3.x plugin for reservation/booking systems (salons, clinics, consultants, etc.). The project starts from the official Payload plugin template with placeholder code. We'll replace the template content with a full-featured reservation system: 5 standalone collections, business logic hooks, and 3 admin UI components.

## File Structure

```
src/
  index.ts                              # Public API: re-exports plugin + types
  plugin.ts                             # Main plugin: (options) => (config) => Config
  types.ts                              # All TypeScript types
  defaults.ts                           # Default config values

  collections/
    Services.ts                         # Service definitions (what can be booked)
    Resources.ts                        # Providers/resources (who performs the service)
    Schedules.ts                        # Availability (recurring + manual slots)
    Reservations.ts                     # Bookings with status workflow
    Customers.ts                        # Customer records with booking history

  hooks/
    reservations/
      calculateEndTime.ts              # Auto-compute endTime from startTime + duration
      validateConflicts.ts             # Prevent double-booking (with buffer time)
      validateStatusTransition.ts      # Enforce status state machine
      validateCancellation.ts          # Enforce cancellation notice period
    index.ts                            # Barrel export

  utilities/
    slotUtils.ts                        # Time math: overlap detection, buffer application
    scheduleUtils.ts                    # Schedule resolution: recurring slots, exceptions

  components/
    CalendarView/
      index.tsx                         # Client: month/week/day calendar for reservations
      CalendarView.module.css
    DashboardWidget/
      DashboardWidgetServer.tsx         # RSC: today's booking stats
      DashboardWidget.module.css
    AvailabilityOverview/
      index.tsx                         # Client: weekly provider availability grid
      AvailabilityOverview.module.css

  exports/
    client.ts                           # CalendarView, AvailabilityOverview exports
    rsc.ts                              # DashboardWidgetServer export
```

## Plugin Configuration Type

```typescript
type ReservationPluginConfig = {
  disabled?: boolean                     // default: false
  slugs?: {                              // Override collection slugs
    services?: string                    // default: 'reservation-services'
    resources?: string                   // default: 'reservation-resources'
    schedules?: string                   // default: 'reservation-schedules'
    reservations?: string               // default: 'reservations'
    customers?: string                  // default: 'reservation-customers'
  }
  adminGroup?: string                    // default: 'Reservations'
  defaultBufferTime?: number             // minutes, default: 0
  cancellationNoticePeriod?: number      // hours, default: 24
  access?: {                             // Override access control per collection
    services?: CollectionConfig['access']
    resources?: CollectionConfig['access']
    schedules?: CollectionConfig['access']
    reservations?: CollectionConfig['access']
    customers?: CollectionConfig['access']
  }
}
```

## Collection Schemas

### Services (`reservation-services`)
| Field | Type | Details |
|-------|------|---------|
| `name` | text | Required, useAsTitle, max 200 |
| `description` | textarea | Optional |
| `duration` | number | Required, min 1, label "Duration (minutes)" |
| `price` | number | Optional, min 0, step 0.01 |
| `bufferTimeBefore` | number | Optional, min 0, default 0 |
| `bufferTimeAfter` | number | Optional, min 0, default 0 |
| `active` | checkbox | Default true, sidebar |

### Resources (`reservation-resources`)
| Field | Type | Details |
|-------|------|---------|
| `name` | text | Required, useAsTitle, max 200 |
| `description` | textarea | Optional |
| `services` | relationship | hasMany to Services, required |
| `active` | checkbox | Default true, sidebar |

### Schedules (`reservation-schedules`)
| Field | Type | Details |
|-------|------|---------|
| `name` | text | Required, useAsTitle |
| `resource` | relationship | To Resources, required |
| `scheduleType` | select | `'recurring'` or `'manual'`, default `'recurring'` |
| `recurringSlots` | array | Shown when type=recurring. Sub-fields: `day` (select mon-sun), `startTime` (text HH:mm), `endTime` (text HH:mm) |
| `manualSlots` | array | Shown when type=manual. Sub-fields: `date` (date dayOnly), `startTime` (text HH:mm), `endTime` (text HH:mm) |
| `exceptions` | array | Always visible. Sub-fields: `date` (date dayOnly), `reason` (text optional) |
| `active` | checkbox | Default true, sidebar |

### Customers (`reservation-customers`)
| Field | Type | Details |
|-------|------|---------|
| `name` | text | Required, useAsTitle, max 200 |
| `email` | email | Required, unique |
| `phone` | text | Optional, max 50 |
| `notes` | textarea | Optional |
| `bookings` | join | On Reservations.customer (virtual reverse relationship) |

### Reservations (`reservations`)
| Field | Type | Details |
|-------|------|---------|
| `service` | relationship | To Services, required |
| `resource` | relationship | To Resources, required |
| `customer` | relationship | To Customers, required |
| `startTime` | date | Required, dayAndTime picker |
| `endTime` | date | Auto-calculated, readOnly, dayAndTime |
| `status` | select | `pending` / `confirmed` / `completed` / `cancelled` / `no-show`, default `pending` |
| `cancellationReason` | textarea | Shown when status=cancelled |
| `notes` | textarea | Optional |

Hooks: `beforeChange: [calculateEndTime, validateConflicts, validateStatusTransition, validateCancellation]`

## Hook Logic

### calculateEndTime
- Load service via `req.payload.findByID` (pass `req` for transaction safety)
- Compute `endTime = startTime + service.duration` minutes
- Set `data.endTime`

### validateConflicts
- Resolve buffer times from service (fallback to `pluginConfig.defaultBufferTime`)
- Compute blocked window: `effectiveStart = start - bufferBefore`, `effectiveEnd = end + bufferAfter`
- Query reservations for same resource where status is not `cancelled`/`no-show`, excluding self on updates, and time overlaps
- Throw `ValidationError` if conflicts found

### validateStatusTransition
- On create: must be `pending`
- On update: check `VALID_STATUS_TRANSITIONS[previousStatus]` allows `newStatus`
- Valid transitions: pending -> confirmed/cancelled; confirmed -> completed/cancelled/no-show; completed/cancelled/no-show are terminal

### validateCancellation
- On update to `cancelled`: check hours until startTime >= `cancellationNoticePeriod`
- Throw `ValidationError` if too late to cancel

All hooks check `context.skipReservationHooks` for escape hatch.

## Admin Components

### DashboardWidget (RSC, beforeDashboard)
- Queries today's reservations via `payload.find()`
- Shows: total today, upcoming, completed, cancelled, next appointment details

### CalendarView (Client, replaces Reservations list view)
- CSS Grid calendar (no external deps) with month/week/day toggle
- Fetches reservations via REST API for visible date range
- Color-coded by status (pending=yellow, confirmed=blue, completed=green, cancelled=gray, no-show=red)
- Click opens document drawer via `useDocumentDrawer`

### AvailabilityOverview (Client, custom admin view at `/reservation-availability`)
- Fetches resources + schedules + existing reservations via REST API
- Renders weekly grid: rows=resources, columns=days
- Shows available slots (green) vs booked (blue) vs exceptions (gray)

Slugs passed to components via `config.admin.custom.reservationSlugs`.

## Implementation Phases

### Phase 1: Foundation
1. Create `src/types.ts` - all type definitions
2. Create `src/defaults.ts` - default config values
3. Create `src/plugin.ts` - plugin shell (merges config, adds collections, handles disabled)
4. Update `src/index.ts` - re-export plugin + types
5. Update `dev/payload.config.ts` to use new config shape
6. Verify dev server starts

### Phase 2: Collections
1. Create all 5 collection files as factory functions receiving resolved config
2. Wire into `plugin.ts`
3. Run `pnpm dev:generate-types`, test CRUD in admin

### Phase 3: Utilities
1. Create `src/utilities/slotUtils.ts` - time math helpers
2. Create `src/utilities/scheduleUtils.ts` - schedule resolution

### Phase 4: Business Logic Hooks
1. Create all 4 hook files + barrel export
2. Wire hooks into Reservations collection
3. Test: auto endTime, conflict prevention, status transitions, cancellation rules

### Phase 5: Admin Components
1. DashboardWidgetServer (RSC)
2. CalendarView (client)
3. AvailabilityOverview (client)
4. Update exports/client.ts and exports/rsc.ts
5. Wire into plugin.ts, run `pnpm dev:generate-importmap`

### Phase 6: Testing & Polish
1. Update `dev/int.spec.ts` with integration tests for all hooks and collections
2. Update `dev/seed.ts` with sample data
3. Run `pnpm build` + `pnpm lint`

## Verification
1. `pnpm dev` - admin panel loads, all 5 collections appear under "Reservations" group
2. Create a service, resource, schedule, customer manually in admin
3. Create a reservation - verify endTime auto-calculates
4. Try overlapping reservation - verify conflict error
5. Try invalid status transition - verify error
6. Try late cancellation - verify error
7. Dashboard widget shows today's stats
8. Calendar view renders reservations visually
9. Availability overview shows provider grid
10. `pnpm build` succeeds

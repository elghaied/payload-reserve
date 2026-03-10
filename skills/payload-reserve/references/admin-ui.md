# Admin UI

Three admin components are registered automatically by the plugin.

## Calendar View

Replaces the default Reservations list view with a CSS Grid-based calendar. No external calendar library.

**View modes:** Month, Week, Day — switchable in the header toolbar.

**Features:**
- Color-coded reservations by status
- Resource filter dropdown (shown when more than one resource exists)
- Click empty cell to create with time pre-filled
- Click reservation chip to open edit drawer
- Hover tooltips: service, time range, customer, resource, status
- Current time indicator (red line) in week/day views
- Status legend below toolbar

Status colors derive from `config.admin.custom.reservationStatusMachine`.

**Import:**
```typescript
import { CalendarView } from 'payload-reserve/client'
```

---

## Dashboard Widget

React Server Component showing today's booking stats:
- Total reservations today
- Upcoming (not yet completed/cancelled)
- Completed
- Cancelled
- Next appointment time and status

Uses Payload Local API server-side — no HTTP round-trip.

**Widget slug:** `reservation-todays-reservations`

**Import:**
```typescript
import { DashboardWidgetServer } from 'payload-reserve/rsc'
```

---

## Availability Overview

Custom admin view at `/admin/reservation-availability`. Weekly grid of resource availability vs. booked slots.

**Grid layout:**
- **Rows** — active resources
- **Columns** — days of the current week
- **Green** — available windows (from schedules)
- **Blue** — booked windows (from reservations)
- **Gray** — exception dates (unavailable)

Navigate weeks with previous/next buttons. Shows remaining capacity for multi-unit resources (`quantity > 1`).

**Import:**
```typescript
import { AvailabilityOverview } from 'payload-reserve/client'
```

---

## Accessing Config in Components

```typescript
// Collection slugs
config.admin.custom.reservationSlugs
// { services, resources, schedules, reservations, customers }

// Status machine (for color coding, transitions, etc.)
config.admin.custom.reservationStatusMachine
// { statuses, defaultStatus, terminalStatuses, blockingStatuses, transitions }
```

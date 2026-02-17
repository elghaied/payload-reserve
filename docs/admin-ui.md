# Admin UI

Three admin components are registered by the plugin automatically.

---

## Calendar View

Replaces the default Reservations list view with a CSS Grid-based calendar. No external calendar library dependencies.

**View modes:** Month, Week, Day — switchable in the header toolbar.

**Features:**
- Color-coded reservations by status (configurable when using a custom status machine)
- Click any empty cell to open a create drawer with the time pre-filled
- Click any reservation chip to open its edit drawer
- Hover tooltips showing service, time range, customer, resource, and status
- Current time indicator (red line) in week and day views
- Status legend below the toolbar

Status colors are derived from the status machine configuration exposed via `config.admin.custom.reservationStatusMachine`.

**Import path (if you need the component directly):**

```typescript
import { CalendarView } from 'payload-reserve/client'
```

---

## Dashboard Widget

A Payload modular dashboard widget (React Server Component) showing today's booking statistics:

- Total reservations today
- Upcoming (not yet completed or cancelled)
- Completed
- Cancelled
- Next appointment time and status

The widget uses the Payload Local API server-side — no HTTP round-trip. It respects the configured `reservations` slug.

**Widget slug:** `reservation-todays-reservations`

**Import path (if you need the component directly):**

```typescript
import { DashboardWidgetServer } from 'payload-reserve/rsc'
```

---

## Availability Overview

A custom admin view registered at `/admin/reservation-availability`. Displays a weekly grid showing resource availability vs. booked slots.

**Grid layout:**
- **Rows** — active resources
- **Columns** — days of the current week
- **Green slots** — available windows (from schedules)
- **Blue slots** — booked windows (from reservations)
- **Gray** — exception dates (unavailable)

Navigate between weeks with previous/next buttons. Shows remaining capacity for multi-unit resources (when `quantity > 1`).

**Import path (if you need the component directly):**

```typescript
import { AvailabilityOverview } from 'payload-reserve/client'
```

---

## Accessing Config in Components

Components access collection slugs and the status machine via `config.admin.custom`:

```typescript
// Collection slugs
config.admin.custom.reservationSlugs
// { services, resources, schedules, reservations, customers }

// Status machine (for color coding, transitions, etc.)
config.admin.custom.reservationStatusMachine
// { statuses, defaultStatus, terminalStatuses, blockingStatuses, transitions }
```

---

← [REST API](./rest-api.md) | → [Examples](./examples.md) | ↑ [Back to README](../README.md)

# Admin UI

The plugin registers several admin components automatically: a calendar view, an availability-aware time field on the reservation form, a dashboard widget, and a weekly availability overview.

---

## Calendar View

Replaces the default Reservations list view with a CSS Grid-based calendar. No external calendar library dependencies.

**View modes:** Month, Week, Day, Lanes, and Pending — switchable in the header toolbar.

- **Month / Week / Day** — CSS Grid calendar of reservations.
- **Lanes** — a resource-lane day timeline: one horizontal track per resource for the selected day, with a time ruler across the top. Each track is shaded by availability and free cells are clickable to book (see below).
- **Pending** — a review queue of reservations in the configured default status. Supports per-row quick confirm/cancel, multi-select, and a bulk-confirm action. A badge on the toolbar shows the pending count (filtered by the selected resource when a resource filter is active).

**Features:**
- Color-coded reservations by status (built-in colors for known statuses; custom statuses auto-assigned from a palette, derived from the status machine config)
- Resource filter dropdown (shown when more than one active resource exists) that scopes every view, including multi-resource bookings whose `items[]` reference the selected resource
- Click any reservation chip to open its edit drawer; hover tooltips show service, time range, customer, resource(s), and status
- Multi-resource bookings render a row of resource-name badges on the event chip
- Current time indicator (red line) in Week and Day views
- Status legend below the toolbar

All views key days, bucket reservations, and render times in the configured business `timezone` (read from `config.admin.custom.reservationTimezone`), not the browser's local zone.

**Data correctness:**
- **Month** view fetches the full 6-week (42-cell) span it renders, so trailing weeks are never silently empty.
- **Week / Day / Lanes** derive their visible-hour window from the day's bookings rather than a fixed window — a booking outside business hours is still shown, and the three time views agree on the same window (never narrower than the default 7–20 business window).
- Reservation fetches are guarded against stale responses, so rapid navigation can't let a slow earlier fetch overwrite a newer one.
- List fetches are capped; when the total exceeds the cap, a "showing N of M" notice is surfaced rather than silently truncating.

Status colors are derived from the status machine configuration exposed via `config.admin.custom.reservationStatusMachine`.

### Availability shading and click-to-book

When a resource is selected in the filter, the Week, Day, and Lanes views shade each time slot by the resource's real availability, fetched from the read-only `/api/reserve/resource-availability` endpoint and classified client-side:

| State | Meaning | Interactive |
|-------|---------|-------------|
| `free` | Within a shift window, capacity available | Yes — click to book |
| `full` | Resource (or a required shared pool) at capacity | No |
| `off-shift` | Outside the resource's schedule windows | No |
| `time-off` | Inside a schedule exception (vacation/closure/etc.) — shows the leave type or reason | No |

Clicking a free slot opens the create drawer pre-filled with both the `startTime` and the selected `resource`. In the Lanes view, clicking a free cell pre-fills that specific lane's resource. For multi-unit resources (`quantity > 1`), free/full cells display an occupancy badge (`occupancy / quantity`). When no resource is selected, slots are unshaded and clicking any cell opens the create drawer with just the time pre-filled.

**Import path (if you need the component directly):**

```typescript
import { CalendarView } from 'payload-reserve/client'
```

---

## Availability Time Field

The reservation form's `startTime` field is replaced by an availability-aware slot picker (`AvailabilityTimeField`).

- Once both a **Service** and a **Resource** are chosen on the form, the field shows a date picker plus a list of bookable start-time slots for that day.
- Slots are fetched live from `GET /api/reserve/slots` (`resource`, `service`, `date`), so the picker reflects schedules, conflicts, buffers, and capacity.
- Selecting a slot sets `startTime`; the selected slot is highlighted.
- Before a service and resource are selected, it falls back to a plain `datetime-local` input.

```typescript
import { AvailabilityTimeField } from 'payload-reserve/client'
```

---

## Dashboard Widget

A Payload modular dashboard widget (React Server Component) showing today's booking statistics:

- **Total** — all reservations starting today
- **Active** — reservations in a blocking status (holding a slot)
- **Upcoming** — blocking reservations that haven't started yet
- **Terminal** — reservations in a terminal status (completed, cancelled, no-show, etc.)
- **Next appointment** — the earliest upcoming blocking reservation, with its time and status

Stat definitions are driven by the configured status machine's `blockingStatuses` and `terminalStatuses` — no status values are hardcoded. The widget uses the Payload Local API server-side — no HTTP round-trip. It respects the configured `reservations` slug.

Stats are computed with `count` queries rather than a capped fetch, so they stay accurate past 100 reservations in a day. "Today" is the business-timezone day (derived from `config.admin.custom.reservationTimezone`), not the server's local day.

> **Note:** The widget is registered as an *available* dashboard widget. Payload only renders it if it appears in the dashboard's default or saved layout — if you don't see it, add it to your dashboard layout.

**Widget slug:** `reservation-todays-reservations`

**Import path (if you need the component directly):**

```typescript
import { DashboardWidgetServer } from 'payload-reserve/rsc'
```

---

## Availability Overview

A custom admin view registered at `/admin/reservation-availability`. Displays a weekly grid showing resource availability vs. booked slots.

**Grid layout:**
- **Rows** — active resources (multi-unit resources show a `(×N)` quantity hint)
- **Columns** — days of the current week
- **Green slots** — available schedule windows (recurring or manual)
- **Gray slots** — exception dates (unavailable), labeled with the exception reason
- **Single-unit resources** — list individual booking start times for that day
- **Multi-unit resources (`quantity > 1`)** — show an "X / Y booked" capacity badge with graduated color (low / mid / full)

Only reservations in a blocking status count toward bookings. Exceptions honor the `date`–`endDate` range — a multi-day time-off block marks every day in the range unavailable, not just the start date. Days are keyed in the configured business `timezone`. Navigate between weeks with previous/next buttons.

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

// Business timezone (for keying days and rendering times)
config.admin.custom.reservationTimezone
// e.g. 'UTC' or 'America/New_York'

// Tenant scoping (when multiTenant is configured)
config.admin.custom.reservationTenant
// { tenantField, cookieName }
```

---

← [REST API](./rest-api.md) | → [Examples](./examples.md) | ↑ [Back to README](../README.md)

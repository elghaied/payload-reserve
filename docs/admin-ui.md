# Admin UI

The plugin registers several admin components automatically: a calendar view, a reservation detail drawer, an availability-aware time field on the reservation form, a dashboard widget, and a weekly availability overview. Every one of these can be replaced with your own component — see [Customising the admin components](#customising-the-admin-components) — and the primitives they're built from are exported for reuse — see [Composing your own admin UI](#composing-your-own-admin-ui).

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
- Click any reservation chip to open the [reservation detail drawer](#reservation-detail-drawer) (Edit is one click further from there, unless you've opted out with `components.reservationDetail: false`); hover tooltips show service, time range, customer, resource(s), and status
- Multi-resource bookings render a row of resource-name badges on the event chip
- Current time indicator (red line) in Week and Day views
- Status legend below the toolbar

All views key days, bucket reservations, and render times in the configured business `timezone` (read from `config.admin.custom.reservationTimezone`), not the browser's local zone.

**Per-tenant timezones (`multiTenant`):** when tenant scoping is active, the Calendar, Availability grid, and Dashboard widget resolve day-boundaries in the **selected tenant's** zone — `tenant's timezoneField → global timezone → 'UTC'`. The server resolves this from the tenant cookie (the calendar fetches it from `GET /api/reserve/effective-timezone`; the RSC dashboard resolves it inline). Set `multiTenant.timezoneField` (default `'timezone'`) to point at the field on your tenant document. A tenant with no timezone value transparently falls back to the global default, so plain single-tenant installs are unaffected.

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

## Reservation Detail Drawer

Clicking a reservation chip on the Calendar — or a row in the Pending view — opens a read-optimized drawer over the calendar instead of jumping straight to Payload's full edit form. The full form is still one click away (the **Edit** button), but the common "glance, then confirm or cancel" action no longer requires opening it.

**Header:** the service name, the reservation's time window, and a status badge.

**Body:** a single-column stack of label/value rows, in order:
- **Customer** — the customer's name, or for a guest booking, the guest's name/email (labeled **Guest** instead of **Customer**)
- **Resource** — the primary resource's name
- **Guest count** — shown only when the reservation has a `guestCount`
- **Also books** — additional `items[]` resources beyond the primary one, rendered as pills
- **Cancellation reason** — shown only when present

Every row's value shares a right edge, so the drawer scans top-to-bottom in one line per field — a deliberate layout choice, not incidental styling.

**Footer:** transition buttons for every status reachable from the current one, per the configured status machine, plus **Edit**.

- **There is deliberately no separate "Cancel" button.** The transition targeting the configured `cancelStatus` raises a `window.prompt` asking for a cancellation reason before submitting. This is what keeps the drawer working unmodified with a custom status vocabulary — there is no hardcoded `'cancelled'` anywhere in it, only the machine's own `cancelStatus`.
- **The buttons are candidates, not permissions.** The drawer renders whatever the status machine says is reachable from the current status; it does not predict whether the server will accept the transition. The server (`validateStatusTransition`, `validateCancellation`) is the sole authority, and a refusal is surfaced to the user as the server's own message — for example, a cancellation attempted inside the notice period now shows "Cancellations require at least N hours notice…" instead of Payload's generic "The following field is invalid: status".
- **Edit** closes the detail drawer and opens the existing document edit drawer, unchanged from before this feature — nothing about editing a reservation's raw fields is different.

**The drawer holds an id, not a document.** The reservation shown is resolved live from whatever the calendar already fetched at `depth: 1` to draw the grid — `service`, `resource`, `customer`, and `items` are populated; nothing deeper is. There is deliberately no second fetch when the drawer opens: that would add a second cache and a loading state the design specifically avoids. **Consequence worth knowing:** a component that needs `depth: 2`, or a field/relationship the calendar doesn't request, must fetch it itself (keyed off the reservation's `id`) rather than expecting the drawer to provide it — see [Composing your own admin UI](#composing-your-own-admin-ui) below.

Opt out entirely with `components.reservationDetail: false` to restore the pre-feature click behaviour — clicking a calendar event opens the document edit drawer directly, with no detail step in between. See the asymmetry note under [Customising the admin components](#customising-the-admin-components).

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

## Customising the admin components

The `components` plugin option replaces any of the plugin's six admin components with your own, without forking the plugin:

```typescript
payloadReserve({
  components: {
    dashboardWidget: false,
    reservationDetail: '/components/MyReservationDetail.tsx#MyReservationDetail',
  },
})
```

Each of the six slots takes one of three values:

| Value | Meaning |
|-------|---------|
| a **string** | your own Payload component path (`'/components/MyCalendar.tsx#MyCalendar'`) |
| **`false`** | opt out |
| **unset** | use the plugin's own component (the default) |

| Slot | Plugin default | `false` falls back to |
|------|-----------------|------------------------|
| `calendarView` | the calendar (month/week/day/lanes/pending) | Payload's default list view |
| `customerField` | the customer picker (search-or-create) | a plain relationship field |
| `availabilityTimeField` | the availability-aware slot picker | a plain date field |
| `dashboardWidget` | today's stats widget | not registering the widget |
| `availabilityOverview` | the weekly availability grid | not registering the view |
| `reservationDetail` | the reservation detail drawer body | see below — **not** a Payload default |

### `false` is asymmetric

For five of the six slots, `false` falls back to a genuine Payload default — the collection's ordinary list view, a plain relationship or date field, or simply not registering a widget/view. There is nothing plugin-specific left behind.

`reservationDetail` has no Payload default to fall back to — Payload never shipped a detail-drawer step in the first place, the plugin added it. Setting `components.reservationDetail: false` instead restores the **pre-feature click behaviour**: clicking a calendar event opens the document edit drawer directly, with no detail step in between.

This is deliberately phrased as restoring the previous **click** behaviour, not the previous release byte-for-byte. One change ships alongside this feature and applies regardless of this flag: the Pending view's quick-action (✓/✗) failures now render the server's own error message instead of the old generic `reservation:pendingConfirmError`/`pendingCancelError` strings — for example, a notice-period rejection now shows the real sentence. `components.reservationDetail: false` does not undo that; it only changes what a calendar click opens. Saying "`false` restores the previous behaviour exactly" would be imprecise for this reason.

### Regenerate the import map

**Whenever you set any slot to a string, run `payload generate:importmap` and restart your app afterward.** Payload resolves every admin component path through an import map generated **into your own app**, not this package. A stale import map means your replacement component silently fails to render — the server logs `PayloadComponent not found in importMap` and, depending on the slot, either nothing renders or Payload's own fallback (from the table above) is shown with no indication anything is misconfigured.

This applies to `calendarView` too, and matters even if you never touch `components` at all: this release changed the *plugin's own* default `calendarView` component from `payload-reserve/client#CalendarView` to `payload-reserve/rsc#CalendarViewServer`, so every existing install needs one `generate:importmap` run after upgrading. See the [Getting Started](./getting-started.md) upgrade note and the README's "⚠️ Upgrading from an earlier version" section for the full failure mode.

### `reservationDetail` and `calendarView` together

If you also replace `calendarView` with your own component, nothing renders your `reservationDetail` slot automatically — `CalendarViewServer` (the plugin's server wrapper) is what resolves `components.reservationDetail` out of the import map and wires it into the drawer. A replacement calendar that wants the same drawer behaviour needs to render `ReservationDetailProvider`/`useReservationDetail` itself (see [Composing your own admin UI](#composing-your-own-admin-ui), below). The plugin logs a boot warning whenever both `components.reservationDetail` and `components.calendarView` are set together — as a string, or as `false` — as a reminder that the detail component will not appear on its own in either case.

---

## Composing your own admin UI

`payload-reserve/client` exports the primitives, hooks, and types the built-in `ReservationDetail` component is composed from, so a replacement doesn't have to reinvent them. `payload-reserve/rsc` exports the server wrapper that resolves `components.reservationDetail` out of the import map.

**From `payload-reserve/client`:**

| Export | Kind | What it is |
|--------|------|------------|
| `CalendarView` | component | the built-in calendar (month/week/day/lanes/pending) |
| `AvailabilityOverview` | component | the built-in weekly availability grid |
| `AvailabilityTimeField` | component | the built-in availability-aware slot picker |
| `CustomerField` | component | the built-in customer search-or-create field |
| `ReservationDetail` | component | the built-in detail-drawer body |
| `ReservationDetailProvider` | component | supplies `useReservationDetail()` to its subtree — needed only if you replace `calendarView` too |
| `useReservationDetail` | hook | `() => { doc, close, refresh }` — the open reservation (or `null`), and drawer controls |
| `useReservationStatusMachine` | hook | `() => { statuses, defaultStatus, cancelStatus, confirmStatus, labels, presentation, transitionsFrom }` — the resolved status machine plus derived labels/colours |
| `useReservationMutations` | hook | `() => { transition, cancel }` — performs a status-change `PATCH` against the reservation and reports the outcome |
| `StatusBadge` | component | a status pill — `{ label, presentation? }` |
| `DetailRow` | component | one label/value line — `{ label, value?, children? }` |
| `StatusActionBar` | component | renders the transition buttons reachable from a status — `{ status, onSelect, busy? }` |
| `EventPill` | component | a single reservation as it appears in a calendar cell |
| `CalendarReservation` | type | the loose, UI-shaped reservation type the calendar/detail components use (see the rename note below) |
| `ReservationItem` | type | one entry of a multi-resource reservation's `items[]`, UI-shaped |
| `ResourceOption` | type | a resource as offered in a picker |
| `StatusPresentation` | type | `{ background, foreground }` colour pair for one status |
| `BUILTIN_STATUSES` | value | the five built-in status strings, for `buildStatusPresentation`/`buildStatusLabels` |
| `buildStatusLabels` | function | `(statuses, t) => Record<string, string>` — translated labels, falling back to the raw string for a custom status with no translation |
| `buildStatusPresentation` | function | `(statuses) => Record<string, StatusPresentation>` — colour assignment; see the palette note below |

Each component and hook above also exports its own prop/return type by name (`StatusBadgeProps`, `DetailRowProps`, `EventPillProps`, `StatusActionBarProps`, `ReservationDetailProps`, `ReservationDetailContextValue`, `ReservationStatusMachine`, `ReservationMutations`, `MutationResult`) — not enumerated separately above, but discoverable from `payload-reserve/client`'s own type exports if you're typing a wrapper around one of them.

**From `payload-reserve/rsc`:**

| Export | Kind | What it is |
|--------|------|------------|
| `CalendarViewServer` | component | the server wrapper around `CalendarView` — resolves `components.reservationDetail` out of `payload.importMap` and hands the client calendar a pre-rendered element. This is the plugin's default `calendarView` component as of this release |
| `DashboardWidgetServer` | component | the built-in dashboard widget |

**Renamed:** the package root's `Reservation` type is now `CalendarReservation` (type-only change, no runtime effect). It's a deliberately loose, UI-shaped structural type — exporting it as plain `Reservation` from the root was too easy to mistake for your app's own generated `payload-types` `Reservation`. `ReservationItem` keeps its name; Payload doesn't generate a type by that name, so there's no equivalent collision.

**Custom status colours may shift.** Palette assignment moved from indexing the whole `statuses` array to a counter over custom (non-built-in) statuses only, and a custom status now also gets an explicit foreground colour rather than inheriting the default. For a machine like `['pending', 'confirmed', 'waitlisted']`, the `waitlisted` swatch can render a different colour than before. Built-in statuses (`pending`, `confirmed`, `completed`, `cancelled`, `no-show`) are unaffected — their exact colour pairs carried over verbatim.

### Writing a custom `reservationDetail` component

Two constraints are load-bearing, not stylistic:

- **It must be a Client Component** — `'use client'` at the top of the file. The component is resolved on the *server* by `CalendarViewServer` out of Payload's import map, and rendered to an element before it reaches the client calendar, so it can never receive per-click props the way a normal React component would.
- **It reads its data from `useReservationDetail()`, not props.** `doc` is the same `depth: 1` fetch the calendar already made to draw the grid, and is `null` while the drawer is closed — return `null` for that case. If your component needs a field or relationship the calendar doesn't fetch (anything past `depth: 1`), fetch it yourself, keyed off `doc.id`, rather than expecting the drawer to provide it — see [Reservation Detail Drawer](#reservation-detail-drawer), above.

A worked example, using the primitives and hooks the built-in component is built from:

```tsx
'use client'
import {
  DetailRow,
  StatusActionBar,
  StatusBadge,
  useReservationDetail,
  useReservationMutations,
  useReservationStatusMachine,
} from 'payload-reserve/client'

export const MyReservationDetail = () => {
  const { doc, refresh } = useReservationDetail()
  const { labels, presentation } = useReservationStatusMachine()
  const { transition } = useReservationMutations()

  if (!doc) return null

  const handleSelect = async (next: string) => {
    // `onSelect` receives the TARGET status — StatusActionBar only renders the
    // candidate buttons from the configured status machine. It is the caller's
    // job to perform the mutation.
    const result = await transition(doc.id, next)

    // The server (`validateStatusTransition`, `validateCancellation`) is the
    // sole authority on whether a transition is legal. Only refresh the
    // calendar's list on success; surface `result.message` on failure — the
    // built-in `ReservationDetail` (`src/components/ReservationDetail/index.tsx`)
    // shows one pattern for rendering that feedback if you want a fuller
    // reference. Never write `onSelect={() => refresh()}` — that renders
    // buttons that call the server for nothing and refresh regardless of
    // whether anything actually changed.
    if (result.ok) refresh()
  }

  return (
    <div>
      <StatusBadge label={labels[doc.status] ?? doc.status} presentation={presentation[doc.status]} />
      <DetailRow label="Booking ref" value={doc.id} />
      <StatusActionBar onSelect={(next) => void handleSelect(next)} status={doc.status} />
    </div>
  )
}
```

Register it and regenerate the import map:

```typescript
payloadReserve({
  components: {
    reservationDetail: '/components/MyReservationDetail.tsx#MyReservationDetail',
  },
})
```

```bash
payload generate:importmap
```

`useReservationMutations()` also exposes `cancel(id, status, reason?)` for the cancel transition specifically, if you want to collect a cancellation reason the way the built-in component does — `status` there is the resolved `cancelStatus` from `useReservationStatusMachine()`, not a literal `'cancelled'`, so a custom status vocabulary keeps working.

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
// { tenantField, cookieName, timezoneField }
```

---

← [REST API](./rest-api.md) | → [Examples](./examples.md) | ↑ [Back to README](../README.md)

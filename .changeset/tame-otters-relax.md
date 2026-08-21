---
'payload-reserve': minor
---

feat(calendar): add a reservation detail drawer and a `components` option for customising six admin components

Clicking a reservation on the calendar (or a row in the Pending view) now opens a **detail
drawer** first — a status badge, key fields, and a status action bar wired to the real
transition rules — rather than jumping straight to the document edit form. An **Edit** button
in the drawer opens the full form for anyone who needs it. Opt out entirely with
`components.reservationDetail: false` to restore the previous click-straight-to-edit behaviour.

New plugin option, `components`, lets you replace any of six admin components with your own
Payload component, without forking the plugin:

```typescript
payloadReserve({
  components: {
    dashboardWidget: false,
    reservationDetail: '/components/MyReservationDetail.tsx#MyReservationDetail',
  },
})
```

Each slot (`calendarView`, `customerField`, `availabilityTimeField`, `dashboardWidget`,
`availabilityOverview`, `reservationDetail`) takes a component path string, `false` to opt
out, or stays unset to use the plugin's own component. `false` is asymmetric: for the first
five it falls back to a Payload default; `reservationDetail` has none, so `false` there
means "go back to v3.1.1 behaviour" instead. **Run `payload generate:importmap` after
setting any slot to a string** — Payload resolves component paths through a generated
import map, and a stale one means silent non-rendering.

`payload-reserve/client` newly exports the primitives and hooks the built-in detail drawer
is composed from — `DetailRow`, `EventPill`, `ReservationDetail`, `ReservationDetailProvider`,
`StatusActionBar`, `StatusBadge`, `useReservationDetail`, `useReservationMutations`, and
`useReservationStatusMachine` — so a replacement `reservationDetail` component doesn't have
to reinvent them. `payload-reserve/rsc` newly exports `CalendarViewServer`, the server
wrapper that resolves `components.reservationDetail` out of the import map and hands the
client calendar a pre-rendered element; it is now the calendar's default list-view
component, up from the plain client `CalendarView`.

**User-visible side effect, easy to miss: a custom status may render in a different colour
than before, and now gets a matching text colour.** Palette assignment changed from
"index into the whole `statuses` array" to "index over custom (non-built-in) statuses
only" — for a machine like `['pending', 'confirmed', 'waitlisted']`, the `waitlisted`
swatch changes, and now has an explicit foreground colour instead of inheriting the
default. Built-in statuses (`pending`, `confirmed`, `completed`, `cancelled`, `no-show`)
are unaffected — their exact background/foreground pairs were carried over verbatim.

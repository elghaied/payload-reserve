---
'payload-reserve': minor
---

feat(calendar): add a reservation detail drawer and a `components` option for customising six admin components

## ⚠️ Action required after upgrading — even if you never touch the new `components` option

The Reservations list view's default component changed from `payload-reserve/client#CalendarView`
to `payload-reserve/rsc#CalendarViewServer`. Payload resolves every admin component path through
an import map generated **into your own app**, not this package, so an existing install that
upgrades and restarts without regenerating it still has the *old* key and is missing the *new*
one. The result is silent: a missing import-map key logs a `console.error` server-side and
Payload's List view falls back to its default table — your admin sees a plain reservations
table where the calendar used to be, with nothing in the UI explaining why.

**Run `payload generate:importmap` after installing this version, then restart your app.** Do
this every time regardless of whether you set any `components` slot — it is not optional, and
skipping it loses the calendar.

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
restores v3.1.1 **click** behaviour instead — see the disclosures below for why that isn't
quite byte-for-byte. **Run `payload generate:importmap` after setting any slot to a
string** — Payload resolves component paths through a generated import map, and a stale one
means silent non-rendering.

`payload-reserve/client` newly exports the primitives and hooks the built-in detail drawer
is composed from — `DetailRow`, `EventPill`, `ReservationDetail`, `ReservationDetailProvider`,
`StatusActionBar`, `StatusBadge`, `useReservationDetail`, `useReservationMutations`, and
`useReservationStatusMachine` — so a replacement `reservationDetail` component doesn't have
to reinvent them. `payload-reserve/rsc` newly exports `CalendarViewServer`, the server
wrapper that resolves `components.reservationDetail` out of the import map and hands the
client calendar a pre-rendered element; it is now the calendar's default list-view
component, up from the plain client `CalendarView`.

The UI types and helpers a replacement `reservationDetail` component needs —
`ReservationItem`, `ResourceOption`, `buildStatusLabels`, `buildStatusPresentation`,
`BUILTIN_STATUSES`, `StatusPresentation`, and the renamed `CalendarReservation` (see
below) — are now also exported from `payload-reserve/client`, not only the server-only
package root. Writing the `'use client'` detail component this README walks you through no
longer requires importing the server plugin barrel from client code. `buildStatusLabels`'s
translate-function parameter is also widened from the plugin's internal, unexported `PluginT`
to a plain `(key: string) => string`, so it can actually be called from outside the plugin.

**Breaking (type-only): the package-root `Reservation` type is renamed to
`CalendarReservation`.** It is a deliberately loose, UI-shaped structural type for the
calendar/detail-drawer components — exported as plain `Reservation` from the package root it
was too easy to mistake for your own generated `payload-types` `Reservation`, which is what
most people would assume a bare `Reservation` import from this package to be. No runtime
change; update `import type { Reservation } from 'payload-reserve'` to `CalendarReservation`
if you use it. `ReservationItem` is unchanged — it doesn't collide as directly, since Payload
does not itself generate a type by that name.

**User-visible side effect, easy to miss: a custom status may render in a different colour
than before, and now gets a matching text colour.** Palette assignment changed from
"index into the whole `statuses` array" to "index over custom (non-built-in) statuses
only" — for a machine like `['pending', 'confirmed', 'waitlisted']`, the `waitlisted`
swatch changes, and now has an explicit foreground colour instead of inheriting the
default. Built-in statuses (`pending`, `confirmed`, `completed`, `cancelled`, `no-show`)
are unaffected — their exact background/foreground pairs were carried over verbatim.

**Three smaller, easy-to-miss changes bundled into this release:**

- The pending list's quick-action (✓/✗ buttons) failures now render the server's own error
  message instead of the generic `reservation:pendingConfirmError`/`pendingCancelError`
  strings — for example, a notice-period rejection now shows the real sentence. This applies
  **even with `components.reservationDetail: false`**, which is why that flag is described
  above as restoring v3.1.1 **click** behaviour rather than v3.1.1 behaviour exactly.
- The fetch behind the detail drawer's status mutations (`patchReservation` /
  `performReservationPatch`) now sends `credentials: 'include'`; previously it sent none,
  which defaults to `same-origin`. Better for a cross-origin `serverURL`, but undisclosed
  until now.
- `CalendarView`'s exported prop type changed from `React.FC<AdminViewServerProps>` to
  `React.FC<CalendarViewProps>`. Runtime-compatible — nothing changes if you just render the
  component — but a type-level break for anyone who imported and typed against it directly.

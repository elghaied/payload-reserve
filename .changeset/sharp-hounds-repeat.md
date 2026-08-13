---
'payload-reserve': patch
---

fix(dashboard): actually place the "Today's Reservations" widget on the dashboard

The widget has never rendered. `admin.dashboard.widgets` only *registers* a widget —
Payload renders whatever `admin.dashboard.defaultLayout` lists, resolving each entry's
component by slug. The plugin pushed its widget into `widgets` and never added it to
`defaultLayout`, so it was registered, present in the import map, and silently never
placed on any consumer's dashboard.

The placement runs at init rather than at plugin time, and that ordering is load-bearing:
Payload sanitizes the config *after* plugins run, and sanitize both appends its own
`collections` widget and sets `defaultLayout ??= [{ widgetSlug: 'collections' }]`.
Assigning `defaultLayout` from a plugin would therefore win over that `??=` and drop the
Collections cards off the dashboard entirely. By `onInit` the default is materialised and
the widget can be appended to it. A consumer-supplied `defaultLayout` function is wrapped
rather than replaced, an existing entry for the widget is never duplicated, and the whole
step is wrapped so it can never break boot.

Note that a user's **saved** dashboard preferences take precedence over `defaultLayout`,
so anyone who has already customised their dashboard keeps their layout and can add the
widget themselves. That is Payload's own behaviour.

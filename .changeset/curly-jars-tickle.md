---
'payload-reserve': patch
---

fix(calendar): open the reservation drawer on every click, not just the ones that change state

`CalendarView` opened its document drawer indirectly — a click set `drawerDocId`, and a
dependency-less effect called `openDrawer()` on the resulting render. The indirection is
required (the document id is baked into the modal slug, so opening synchronously would
target the previously-opened document), but it assumed a render would always follow. When
a click set `drawerDocId` and `initialData` to the values they already held, React bailed
out of the re-render, the effect never ran, and the click was silently swallowed:

- **"Create New" did nothing on a freshly loaded calendar.** On mount `drawerDocId` is
  already `null` and `initialData` already `undefined`, so the button only started working
  after some other document had been opened and closed.
- **A reservation could not be reopened after its drawer was closed** — via the month/week/day
  event blocks (mouse or keyboard) or the pending tab's customer link.
- The swallowed click also left the open request armed, so the next unrelated re-render
  (changing month, a background refetch) could pop the drawer open on its own.

The open request is now carried by a monotonic counter that always produces a new value, so
the render the effect depends on is guaranteed. All seven entry points route through one
`requestDrawer` helper; the three click-to-book handlers happened to work before only because
they passed a fresh object literal to `setInitialData`, which is incidental and would have
broken had that object ever been memoized.

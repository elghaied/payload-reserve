# External Busy (Calendar Sync & Other Sources)

`getExternalBusy` lets your app fold busy time that payload-reserve doesn't manage — an external calendar, a legacy booking system, ops tooling — into a resource's availability. The plugin never talks to any calendar API itself; it calls a resolver you provide once per candidate window and treats whatever it returns as busy time for that resource.

Use it to:

- Import busy time from two-way calendar sync (Google Calendar, Outlook, iCal feeds)
- Respect bookings made in another/legacy booking system during a migration
- Block maintenance/cleaning windows tracked in an ops system
- Reflect staff leave recorded in an HR system that isn't modeled as plugin time-off

A realistic setup keeps a local collection in sync (via webhooks or a cron job) and has the resolver run a single indexed query against it — the resolver itself never calls a remote API:

```ts
import type { ExternalBusyInterval, GetExternalBusy } from 'payload-reserve'

// A sync job (webhook handler or scheduled cron task) keeps this collection's
// rows current from whatever external source you're integrating — a
// Google/Outlook calendar sync, a legacy system export, an ops tool, etc.
// The resolver below never calls out itself; it only reads what the sync
// job already wrote, so it stays a single cheap, indexed query.
const getExternalBusy: GetExternalBusy = async ({ end, req, resourceId, start }) => {
  const result = await req.payload.find({
    collection: 'external-busy', // your locally-synced collection
    where: {
      and: [
        { resource: { equals: resourceId } },
        { start: { less_than: end.toISOString() } },
        { end: { greater_than: start.toISOString() } },
      ],
    },
    depth: 0,
    limit: 0,
    overrideAccess: true,
  })

  return result.docs.map(
    (doc): ExternalBusyInterval => ({
      start: doc.start,
      end: doc.end,
      label: doc.label,
    }),
  )
}

payloadReserve({
  getExternalBusy,
})
```

- **Enforcement:** any booking (hooks, endpoints, slot listings) overlapping an interval is unavailable. An interval blocks the WHOLE resource (all `quantity` units) — external calendars aren't unit-aware.
- **Display:** the `resource-availability` endpoint returns the intervals as a separate `external[]` array (not mixed into `busy`), and the calendar renders them as a distinct, non-clickable hatched "External event" slot.
- **Fail-open:** if the resolver throws, the plugin treats it as no external busy for that call — a sync failure never blocks a real booking or breaks the grid.
- **Performance:** the resolver is called once per candidate window during slot computation, so keep it cheap — a local table lookup or a per-request cache, never a remote API call per invocation.

---

↑ [Back to README](../README.md)

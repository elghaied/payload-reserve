# Advanced

Performance tuning, database indexes, and high-concurrency patterns.

## Recommended Database Indexes

For production deployments with high booking volume, add these indexes to your database. The conflict detection query filters by `resource`, `status`, `startTime`, and `endTime` on every create and update — the composite `reservation_conflict_lookup` index is the most important one to add.

### MongoDB

```js
db.reservations.createIndex(
  { resource: 1, status: 1, startTime: 1, endTime: 1 },
  { name: 'reservation_conflict_lookup' }
)
db.reservations.createIndex(
  { customer: 1, startTime: -1 },
  { name: 'reservation_customer_history' }
)
db.reservations.createIndex(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'reservation_idempotency' }
)
```

### PostgreSQL

```sql
CREATE INDEX reservation_conflict_lookup
  ON reservations (resource_id, status, start_time, end_time);
CREATE INDEX reservation_customer_history
  ON reservations (customer_id, start_time DESC);
CREATE UNIQUE INDEX reservation_idempotency
  ON reservations (idempotency_key) WHERE idempotency_key IS NOT NULL;
```

### SQLite

```sql
CREATE INDEX reservation_conflict_lookup
  ON reservations (resource_id, status, start_time, end_time);
```

> **Note:** The `idempotencyKey` field has `unique: true` in the Payload schema definition, so Payload-managed databases will have this automatically. The snippets above are for manually adding it if your database was created before this field was introduced.

---

## Collection Overrides

The `collectionOverrides` option customizes any of the generated collections without forking the plugin. Each entry is keyed by collection (`services`, `resources`, `schedules`, `reservations`, `customers`) and accepts `Omit<Partial<CollectionConfig>, 'fields' | 'slug'> & { fields?: ({ defaultFields }) => Field[] }`. The plugin protects its load-bearing behavior:

- **`fields`** — a function receiving the plugin's default fields, returning the final list (append / reorder / replace).
- **`hooks`** — merged per event array; the plugin's hooks always run first, then yours. An override can add hooks but never clobber conflict detection or status hooks.
- **`access`** — composed per operation; rules the override omits survive.
- **`slug`** — ignored (the `slugs` option owns slugs).
- Everything else (`admin`, `labels`, `custom`, …) is shallow-merged.

Example (issue #4): add a reverse `join` field on Services pointing back at the Resources that offer them.

```typescript
payloadReserve({
  collectionOverrides: {
    services: {
      fields: ({ defaultFields }) => [
        ...defaultFields,
        {
          name: 'offeredBy',
          type: 'join',
          collection: 'resources',
          on: 'services',
        },
      ],
    },
  },
})
```

---

```typescript
payloadReserve({
  collectionOverrides: {
    services: {
      // Generic illustration of appending a field via collectionOverrides — not
      // the way to get a services↔resources view: Services already ships that
      // built in as a read-only `resources` join (see below). Don't name your
      // own appended field `resources` on `services`, or it collides with it.
      fields: ({ defaultFields }) => [
        ...defaultFields,
        { name: 'referencedResources', type: 'join', collection: 'resources', on: 'services' },
      ],
    },
    reservations: {
      admin: { group: 'Bookings' },               // shallow-merged
      hooks: { afterChange: [sendConfirmationEmail] }, // MERGED with the plugin's hooks
    },
  },
})
```

> **Note:** a `collectionOverrides.resources` override that removes, renames, or nests the `services` field inside a *named* group or tab causes the Services `resources` join (below) to be silently skipped rather than erroring — the app still boots, the field simply doesn't appear.

## Disabling the Plugin

Setting `disabled: true` keeps all collections **registered** so the database schema stays stable — it does not drop tables/collections. Only the behavior goes inert: hooks, endpoints, admin components, and staff provisioning are removed. This matters for migrations and DB tooling: a disabled install still owns the same schema, so toggling `disabled` does not require a migration.

Because the stripped hooks are what validate customer writes (ownership pinning, conflict detection, the status machine), a disabled plugin also refuses `create`/`update`/`delete` on its collections for non-staff users until it is re-enabled; staff keep writing, and customers keep their self-scoped profile access. Before 4.1.2 a customer could post confirmed, overlapping rows on another customer's account while the kill switch was on.

---

## Reconciliation Job

Simultaneous bookings are serialized by a database lock (see [Concurrent Bookings](./concurrency.md)), so on a database with transactions this job should find nothing. It is still a useful safety net: it catches overlaps created on a database **without** transactions (a standalone MongoDB, or SQLite without `transactionOptions`), by code that used `context.skipReservationHooks`, or by direct database writes.

Add this to your Payload config's `jobs.tasks` array:

```typescript
import type { TaskConfig } from 'payload'

export const reconcileReservations: TaskConfig = {
  slug: 'reconcile-reservations',
  handler: async ({ req }) => {
    // Find all active reservations grouped by resource
    const { docs: activeReservations } = await req.payload.find({
      collection: 'reservations',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      req,
      where: {
        status: { in: ['pending', 'confirmed'] },
      },
    })

    // Group by resource and detect overlaps
    const byResource = new Map<string, typeof activeReservations>()
    for (const reservation of activeReservations) {
      const resourceId = String(reservation.resource)
      if (!byResource.has(resourceId)) {
        byResource.set(resourceId, [])
      }
      byResource.get(resourceId)!.push(reservation)
    }

    let conflictCount = 0
    for (const [, reservations] of byResource) {
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          const a = reservations[i]
          const b = reservations[j]
          const aStart = new Date(a.startTime as string)
          const aEnd = new Date(a.endTime as string)
          const bStart = new Date(b.startTime as string)
          const bEnd = new Date(b.endTime as string)
          if (aStart < bEnd && aEnd > bStart) {
            conflictCount++
            // Flag or alert — e.g., add a note, send a Slack message, etc.
            console.warn(`Conflict detected: ${a.id} overlaps ${b.id}`)
          }
        }
      }
    }

    return { output: { conflicts: conflictCount } }
  },
}
```

Run this job on a schedule (e.g., hourly) using Payload's job queue. The job does not resolve conflicts automatically — it flags them for human review.

---

## Capacity and simultaneous bookings

Capacity is checked as peak concurrency: the most units (bookings, or guests in `per-guest` mode) in use at any one instant of the requested window, compared against `quantity`. Simultaneous bookers for the same resource are serialized by a database lock inside the booking's transaction, so capacity is not exceeded — provided the database has transactions. See [Concurrent Bookings](./concurrency.md) for what each adapter needs and how it behaves under load.

## Multi-Resource Conflict Notes

When a service has `requiredResources`, the plugin expands them into `items[]` and conflict-checks each item independently against its own service's buffer times.

- Conflict detection fetches the blocking reservations via a coarse superset query, then computes **true per-item occupancy** in memory: each occupying item's `[startTime, endTime)` window is expanded by *that item's own* service buffers. Multi-item bookings therefore no longer over-block (only the windows their items actually occupy count), and a neighbor's buffer is enforced against the candidate.
- Conflict detection matches reservations that reference a resource **either** at the top level (`resource`) **or** inside another booking's `items[]` — a resource held only in another booking's items is not invisible.
- If the primary resource is free but a required pool is full, the whole booking is rejected. The reconciliation job should iterate `items[]` (not just the top-level `resource`) when grouping reservations by resource.

---

## The top-level `resource` is always conflict-checked

A booking's top-level `resource` field is now conflict-checked even when the request also supplies an explicit `items[]` that never names it. Previously, a caller could put resource A in the top-level fields and only *other* resources in `items[]`, and A itself was never checked for overlaps — even though every other booking's conflict check already treats A as occupied by this one. Overlaps against the top-level resource that were previously accepted are now rejected.

If you call `resolveReservationItems` directly (it's exported from the package root), note that its returned array can now contain one more entry than before — one synthesized from the top-level `resource`/`startTime`/`endTime` and flagged `fromParent: true` — unless an `items[]` entry for that same resource already, demonstrably, covers the same window.

---

← [Examples](./examples.md) | → [Development](./development.md) | ↑ [Back to README](../README.md)

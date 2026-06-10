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
  ON reservations (resource, status, "startTime", "endTime");
CREATE INDEX reservation_customer_history
  ON reservations (customer, "startTime" DESC);
CREATE UNIQUE INDEX reservation_idempotency
  ON reservations ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
```

### SQLite

```sql
CREATE INDEX reservation_conflict_lookup
  ON reservations (resource, status, startTime, endTime);
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

## Disabling the Plugin

Setting `disabled: true` keeps all collections **registered** so the database schema stays stable — it does not drop tables/collections. Only the behavior goes inert: hooks, endpoints, admin components, and staff provisioning are removed. This matters for migrations and DB tooling: a disabled install still owns the same schema, so toggling `disabled` does not require a migration.

---

## Reconciliation Job

For high-concurrency deployments, rare race conditions between two simultaneous bookings can slip past the hook-level conflict check. A background reconciliation job can detect and flag these after the fact.

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

## Capacity & Quantity Race Considerations

For resources with `quantity > 1` (or `capacityMode: 'per-guest'`), the hook-level check counts existing blocking reservations (or sums `guestCount`) and compares against `quantity`. Under high concurrency, two simultaneous bookings can each read capacity-not-yet-full and both succeed, briefly overbooking. The hook check is best-effort, not a transactional lock.

Mitigations:

- Add the conflict-lookup index above so the capacity read is fast (shrinks the race window).
- Extend the reconciliation job to sum occupancy per resource per time window and compare against `quantity` / per-guest capacity, flagging windows where occupancy exceeds capacity.
- For strict guarantees, enforce capacity at the database layer (e.g. a unique partial index on `(resource, startTime)` for `per-reservation, quantity: 1` resources, or an application-level lock keyed by resource).

## Multi-Resource Conflict Notes

When a service has `requiredResources`, the plugin expands them into `items[]` and conflict-checks each item independently against its own service's buffer times.

- Conflict detection fetches the blocking reservations via a coarse superset query, then computes **true per-item occupancy** in memory: each occupying item's `[startTime, endTime)` window is expanded by *that item's own* service buffers. Multi-item bookings therefore no longer over-block (only the windows their items actually occupy count), and a neighbor's buffer is enforced against the candidate.
- Conflict detection matches reservations that reference a resource **either** at the top level (`resource`) **or** inside another booking's `items[]` — a resource held only in another booking's items is not invisible.
- A partial overbooking is possible if the primary resource is free but a required pool is full; the create is rejected atomically per booking. The reconciliation job should iterate `items[]` (not just the top-level `resource`) when grouping reservations by resource.

---

← [Examples](./examples.md) | → [Development](./development.md) | ↑ [Back to README](../README.md)

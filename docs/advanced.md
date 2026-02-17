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

← [Examples](./examples.md) | → [Development](./development.md) | ↑ [Back to README](../README.md)

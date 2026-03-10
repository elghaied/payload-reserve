# Advanced

Performance tuning, database indexes, and high-concurrency patterns.

## Recommended Database Indexes

For production with high booking volume. The conflict detection query filters by `resource`, `status`, `startTime`, `endTime` on every create/update — the composite index is the most important.

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

> **Note:** `idempotencyKey` has `unique: true` in the Payload schema, so Payload-managed databases get this automatically. The snippets above are for manually adding it to databases created before this field existed.

---

## Reconciliation Job

For high-concurrency deployments, rare race conditions between simultaneous bookings can slip past hook-level conflict checks. A background job can detect and flag these.

Add to your Payload config's `jobs.tasks`:

```typescript
import type { TaskConfig } from 'payload'

export const reconcileReservations: TaskConfig = {
  slug: 'reconcile-reservations',
  handler: async ({ req }) => {
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
            console.warn(`Conflict detected: ${a.id} overlaps ${b.id}`)
          }
        }
      }
    }

    return { output: { conflicts: conflictCount } }
  },
}
```

Run on a schedule (e.g., hourly) via Payload's job queue. Flags conflicts for human review — does not auto-resolve.

# REST API

Five endpoints mounted at `/api/reserve/`. These are Payload custom endpoints — they respect Payload access control.

---

## GET /api/reserve/availability

Available time slots for a resource and service on a given date, derived from the resource's active schedules minus overlapping reservations with blocking statuses.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | Resource ID |
| `service` | Yes | Service ID |
| `date` | Yes | `YYYY-MM-DD` format |

**Response:**

```json
{
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" }
  ]
}
```

```typescript
const res = await fetch('/api/reserve/availability?resource=abc123&service=def456&date=2025-06-15')
const { slots } = await res.json()
```

---

## GET /api/reserve/slots

Available slots with richer metadata. Accepts `guestCount` for capacity-aware filtering.

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `resource` | Yes | — | Resource ID |
| `service` | Yes | — | Service ID |
| `date` | Yes | — | `YYYY-MM-DD` format |
| `guestCount` | No | `1` | Number of guests (for `per-guest` capacity mode) |

**Response:**

```json
{
  "date": "2025-06-15",
  "guestCount": 2,
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" }
  ]
}
```

Returns `400` with `{ "error": "..." }` for missing params or invalid date.

---

## POST /api/reserve/book

Creates a new reservation. All collection hooks run (conflict detection, end time calc, status validation). Runs any registered `beforeBookingCreate` plugin hooks first.

**Request body:**

```json
{
  "service": "def456",
  "resource": "abc123",
  "customer": "cus789",
  "startTime": "2025-06-15T10:00:00.000Z",
  "guestCount": 1,
  "notes": "Please use the side entrance.",
  "idempotencyKey": "frontend-uuid-or-form-id"
}
```

**Response:** `201` with the created reservation, or `400`/`409` if validation fails.

```typescript
const res = await fetch('/api/reserve/book', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service: serviceId,
    resource: resourceId,
    customer: customerId,
    startTime: '2025-06-15T10:00:00.000Z',
    idempotencyKey: crypto.randomUUID(),
  }),
})
const reservation = await res.json()
```

---

## POST /api/reserve/cancel

Cancels a reservation by ID. Requires authenticated session (`req.user`). Enforces `cancellationNoticePeriod`.

**Request body:**

```json
{
  "reservationId": "res123",
  "reason": "Change of plans"
}
```

**Response:** `200` with updated reservation. Returns `401` if not authenticated, `400` if `reservationId` missing.

```typescript
const res = await fetch('/api/reserve/cancel', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reservationId: 'res123', reason: 'Change of plans' }),
})
const updated = await res.json()
```

---

## GET /api/reserve/customers

Searches customers by name or email. Used by admin UI but callable from frontend.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search string (matches name and email) |

**Response:** Array of matching customer documents.

# REST API

The plugin mounts five endpoints under `/api/reserve/`. These are Payload custom endpoints — they respect the same access control as the rest of the API.

---

## GET /api/reserve/availability

Returns available time slots for a resource and service on a given date. Slots are derived from the resource's active schedules for that date minus any overlapping reservations with blocking statuses.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | Resource ID |
| `service` | Yes | Service ID |
| `date` | Yes | Date in `YYYY-MM-DD` format |

**Example request:**

```
GET /api/reserve/availability?resource=abc123&service=def456&date=2025-06-15
```

**Response:**

```json
{
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" },
    { "start": "2025-06-15T10:30:00.000Z", "end": "2025-06-15T11:00:00.000Z" }
  ]
}
```

**Example fetch:**

```typescript
const res = await fetch('/api/reserve/availability?resource=abc123&service=def456&date=2025-06-15')
const { slots } = await res.json()
```

---

## GET /api/reserve/slots

Returns available slots with richer metadata. Accepts an optional `guestCount` parameter for capacity-aware filtering.

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `resource` | Yes | — | Resource ID |
| `service` | Yes | — | Service ID |
| `date` | Yes | — | Date in `YYYY-MM-DD` format |
| `guestCount` | No | `1` | Number of guests (used for `per-guest` capacity mode) |

**Example request:**

```
GET /api/reserve/slots?resource=abc123&service=def456&date=2025-06-15&guestCount=2
```

**Response:**

```json
{
  "date": "2025-06-15",
  "guestCount": 2,
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" }
  ]
}
```

Returns `400` with `{ "error": "..." }` if required parameters are missing or the date is invalid.

---

## POST /api/reserve/book

Creates a new reservation. All Payload collection hooks (conflict detection, end time calculation, status transition validation) run as normal. Runs any registered `beforeBookingCreate` plugin hooks before saving.

**Request body:** Same as `payload.create` data for the reservations collection.

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

**Response:** `201` with the created reservation document, or `400`/`409` if validation fails.

The `idempotencyKey` field prevents duplicate submissions — if a key has already been used, the request is rejected with a validation error.

**Example fetch:**

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

Cancels a reservation. Requires an authenticated session (`req.user`).

**Request body:**

```json
{
  "reservationId": "res123",
  "reason": "Change of plans"
}
```

**Response:** `200` with the updated reservation document.

Returns `401` if not authenticated, `400` if `reservationId` is missing. The `validateCancellation` hook enforces the minimum notice period configured in `cancellationNoticePeriod`.

**Example fetch:**

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

Searches customers by name or email. Used internally by the admin CustomerField component but can be called from your frontend too.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search string (matches name and email) |

**Response:** Array of matching customer documents.

---

← [Hooks API](./hooks-api.md) | → [Admin UI](./admin-ui.md) | ↑ [Back to README](../README.md)

# REST API

The plugin mounts seven endpoints. Six are under `/api/reserve/`; the customer-search endpoint is mounted at `/api/reservation-customer-search`. These are Payload custom endpoints — they respect the same access control as the rest of the API.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reserve/availability` | Available time slots for a resource+service on a date (`guestCount`, `resources`) |
| GET | `/api/reserve/slots` | Available slots with echoed `date`/`guestCount` |
| GET | `/api/reserve/resource-availability` | Shift windows, time-off, and busy intervals for a resource over a date range; staff/admin only |
| GET | `/api/reserve/effective-timezone` | The business timezone for the current request's selected tenant (`tenant → global → UTC`); authenticated only |
| POST | `/api/reserve/book` | Create a booking (supports `guest` and `items`); fires `beforeBookingCreate` hooks |
| POST | `/api/reserve/cancel` | Cancel a booking (authenticated owner/admin, or guest via `token`) |
| GET | `/api/reservation-customer-search` | Search customers by name/email/phone; privileged staff/admin only |

---

## GET /api/reserve/availability

Returns available time slots for a resource and service on a given date. Slots are derived from the resource's active schedules for that date minus any overlapping reservations with blocking statuses.

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `resource` | Yes | — | Resource ID. Used as the caller resource set unless `resources` is supplied. |
| `service` | Yes | — | Service ID |
| `date` | Yes | — | Date in `YYYY-MM-DD` format. A `YYYY-MM-DD` value is interpreted as that calendar day in the business `timezone`. |
| `guestCount` | No | `1` | Number of guests (used for `per-guest` capacity filtering). Clamped to a minimum of 1. A non-numeric value is rejected with `400`. |
| `resources` | No | — | Comma-separated resource IDs to require for the slot (multi-resource bookings). Overrides the single `resource` as the caller set. |

The resolved resource set is the union of the caller resource(s) and the service's `requiredResources` — a slot is only returned if **all** required resources are free.

**Errors:**
- `400 { "message": "Missing required query params: resource, date, service" }` when a required param is missing.
- `400 { "error": "Invalid date format. Expected YYYY-MM-DD" }` when `date` is unparseable or an impossible calendar date (e.g. `2026-13-45`).
- `400 { "error": "Invalid guestCount" }` when `guestCount` is non-numeric.
- `404 { "error": "Service not found" }` / `404 { "error": "Resource not found" }` for an unknown or malformed `service`/`resource` id.

**Example request:**

```
GET /api/reserve/availability?resource=abc123&service=def456&date=2025-06-15
```

**Response:**

```json
{
  "slots": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z" },
    { "start": "2025-06-15T09:30:00.000Z", "end": "2025-06-15T10:00:00.000Z" }
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

Returns available slots with the echoed `date`/`guestCount`. Same resolution logic as `/availability` (capacity- and multi-resource-aware).

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `resource` | Yes | — | Resource ID |
| `service` | Yes | — | Service ID |
| `date` | Yes | — | Date in `YYYY-MM-DD` format. A `YYYY-MM-DD` value is interpreted as that calendar day in the business `timezone`. |
| `guestCount` | No | `1` | Number of guests (used for `per-guest` capacity mode). Clamped to a minimum of 1. A non-numeric value is rejected with `400`. |
| `resources` | No | — | Comma-separated resource IDs to require for the slot. Overrides `resource` as the caller set; unioned with the service's `requiredResources`. |

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

**Errors:**
- `400 { "error": "Missing required query params: resource, date, service" }` when a required param is missing.
- `400 { "error": "Invalid date format. Expected YYYY-MM-DD" }` when `date` is unparseable or an impossible calendar date (e.g. `2026-13-45`).
- `400 { "error": "Invalid guestCount" }` when `guestCount` is non-numeric.
- `404 { "error": "Service not found" }` / `404 { "error": "Resource not found" }` for an unknown or malformed `service`/`resource` id.

---

## GET /api/reserve/resource-availability

Returns a resource's availability over a date range — its shift windows and time-off per day, plus busy intervals (with capacity units) for the resource and any resource pools its services also require. Powers the admin availability calendar shading.

**Authentication:** Staff/admin only — same gate as customer search. Unauthenticated requests get `401`, non-privileged (customer) users get `403`. Privilege is role-aware (`isPrivilegedUser`), so it works whether staff and customers share one auth collection (`userCollection` set) or use separate collections. In single-collection mode you must configure `resourceOwnerMode.adminRoles` and/or `staffProvisioning.staffRoles` so admins resolve as privileged — otherwise every request is treated as a customer and gets `403`.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | Resource ID |
| `start` | Yes | Range start (ISO date/datetime, inclusive) |
| `end` | Yes | Range end (ISO date/datetime, exclusive). The range is capped at 90 days. |

**Errors:**
- `401 { "error": "Unauthorized" }` for an unauthenticated request.
- `403 { "error": "Forbidden" }` for a non-privileged (customer) user.
- `400 { "error": "Missing required query params: resource, start, end" }` when a param is missing.
- `400 { "error": "Invalid start/end date" }` when `start`/`end` are unparseable.
- `400 { "error": "end must be after start" }` when `end` is not after `start`.
- `400 { "error": "Date range too large (max 90 days)" }` when the range exceeds 90 days.
- `404 { "error": "Resource not found" }` when `resource` does not exist.

**Example request:**

```
GET /api/reserve/resource-availability?resource=abc123&start=2025-06-15&end=2025-06-22
```

**Response:**

```json
{
  "busy": [
    { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T09:30:00.000Z", "units": 1 }
  ],
  "capacityMode": "per-reservation",
  "quantity": 1,
  "days": [
    {
      "date": "2025-06-15",
      "shiftWindows": [
        { "start": "2025-06-15T09:00:00.000Z", "end": "2025-06-15T17:00:00.000Z" }
      ],
      "timeOff": [
        { "start": "...", "end": "...", "reason": "Holiday", "type": "closure" }
      ]
    }
  ],
  "requiredPools": [
    { "quantity": 4, "busy": [ { "start": "...", "end": "...", "units": 1 } ] }
  ],
  "timeZone": "Europe/Paris"
}
```

- `busy` — blocking reservations overlapping the range, with `units` (1 per reservation, or `guestCount` when `capacityMode` is `per-guest`). Matches reservations referencing the resource either directly (`resource`) or via `items.resource`.
- `capacityMode` / `quantity` — the resource's capacity configuration.
- `days[]` — one entry per day: `shiftWindows` (resolved schedule ranges) and `timeOff` (full-day exception ranges with optional `reason` and `type`).
- `requiredPools[]` — for each distinct resource that this resource's services also require (e.g. a shared chair pool): its `quantity` and `busy` intervals, so callers can detect when a slot is blocked by a shared pool even when the resource itself is free.
- `timeZone` — the IANA zone the day windows were resolved in: the selected tenant's zone in `multiTenant` mode, otherwise the global `timezone`.

---

## GET /api/reserve/effective-timezone

The business timezone for the current request's selected tenant. The custom admin calendar calls this so its day-boundary rendering follows the tenant selector; the tenant is read from the cookie (`multiTenant.cookieName`, default `payload-tenant`), so no query params are needed.

Resolution precedence: **selected tenant's `timezoneField` → global `timezone` → `'UTC'`**. Requires an authenticated user (401 otherwise). On plain single-tenant installs this always returns the global `timezone` with no extra DB read.

```
GET /api/reserve/effective-timezone
```

**Response:**

```json
{ "timeZone": "Europe/Paris" }
```

---

## POST /api/reserve/book

Creates a new reservation. All Payload collection hooks (guest validation, required-resource expansion, conflict detection, end-time calculation, status-transition validation) run as normal. Runs any registered `beforeBookingCreate` plugin hooks before saving.

**Request body:** Accepts the same data as `payload.create` for the reservations collection. Notable fields:

- `service`, `resource`, `startTime` — core booking fields.
- `customer` — optional; the reservation's customer (relationship). Omit for account-less guest bookings. **Who may set it:** anonymous callers may **not** set `customer` (→ `403`; use the guest flow instead); an authenticated non-staff caller is always forced to book for themselves (`customer` is overwritten with their own id); staff/admin may book for anyone (walk-ins).
- `guest` — optional group `{ name, email, phone }` for account-less (guest) bookings.
- `items[]` — optional array for multi-resource bookings (`{ resource, service?, startTime?, endTime?, guestCount? }`).
- `guestCount` — number of guests (default 1).
- `idempotencyKey` — prevents duplicate submissions; a reused key is rejected with a validation error.
- `cancellationToken` — **ignored.** Any caller-supplied value is stripped from the body; the token is always server-generated (it is a secret).

```json
{
  "service": "def456",
  "resource": "abc123",
  "startTime": "2025-06-15T10:00:00.000Z",
  "guest": { "name": "Jane Doe", "email": "jane@example.com", "phone": "+15551234567" },
  "guestCount": 2,
  "notes": "Please use the side entrance.",
  "idempotencyKey": "frontend-uuid-or-form-id"
}
```

**Response:** `201` with the created reservation document, or `400`/`409` if validation fails. An anonymous caller that supplies a `customer` gets `403 { "error": "Anonymous bookings cannot set a customer" }`. The `cancellationToken` field is **stripped** from the response — it is never echoed over HTTP, and is delivered to the guest by the host project via the `afterBookingCreate` hook.

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

Cancels a reservation. Works in two modes:

- **Authenticated** — the reservation's customer (owner) or a privileged staff/admin user. Privilege is role-aware (`isPrivilegedUser`), so it works whether staff and customers share one auth collection (`userCollection` set) or use separate collections.
- **Guest (unauthenticated)** — supply the `cancellationToken` (delivered to the guest out-of-band) as `token`. No session required.

**Request body:**

```json
{
  "reservationId": "res123",
  "reason": "Change of plans",
  "token": "guest-cancellation-token"
}
```

`token` is only needed for guest (unauthenticated) cancellation; authenticated owners/admins omit it.

**Response:** `200` with the updated reservation document (with `cancellationToken` stripped). The reservation's status is set to the configured `statusMachine.cancelStatus` (default `'cancelled'`), not a hardcoded value — so custom status vocabularies cancel correctly.

**Errors:**
- `400 { "message": "reservationId is required" }` when `reservationId` is missing.
- `403 { "message": "Forbidden" }` when an authenticated user is neither the owner nor privileged, or when a guest supplies a missing/invalid `token`.

There is no `401` response — guest cancellation is supported. The `validateCancellation` hook enforces the minimum notice period configured in `cancellationNoticePeriod`.

**Example fetch (guest):**

```typescript
const res = await fetch('/api/reserve/cancel', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reservationId: 'res123', reason: 'Change of plans', token: cancellationToken }),
})
const updated = await res.json()
```

---

## GET /api/reservation-customer-search

Searches customers by name, email, or phone. Used internally by the admin CustomerField component. Restricted to privileged staff/admin users (role-aware via `isPrivilegedUser`) — unauthenticated requests get `401`, non-privileged users get `403`.

**Query parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `search` | No | `''` | Search string (matched with `contains` against `name`, `firstName`, `lastName`, `phone` where those fields exist, and always `email`). |
| `limit` | No | `10` | Page size (max 50). |
| `page` | No | `1` | Page number (min 1). |

In single-collection mode (`userCollection` set), privileged roles are excluded from results so the dropdown lists only actual customers.

**Response:** `200` with a paginated object:

```json
{
  "docs": [
    { "id": "cus789", "email": "jane@example.com", "name": "Jane Doe", "phone": "+15551234567" }
  ],
  "hasNextPage": false,
  "totalDocs": 1
}
```

Each `docs` entry always includes `id` and `email`; `name`, `firstName`, `lastName`, and `phone` are included only when those fields exist on the target collection.

---

← [Hooks API](./hooks-api.md) | → [Admin UI](./admin-ui.md) | ↑ [Back to README](../README.md)

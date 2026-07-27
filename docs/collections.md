# Collections

Schemas for all five collections created by the plugin.

Any of these collections can be customized — fields, hooks, access — via the `collectionOverrides` plugin option (for example, adding a `join` field on Reservations back to an Invoices or Payments collection you maintain for billing). See [Configuration → `collectionOverrides`](./configuration.md) and [Advanced](./advanced.md).

## Services

**Slug:** `services`

Defines what can be booked (e.g., "Haircut", "Consultation", "Massage").

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Service name (max 200 chars) |
| `image` | Upload | No | Service image. Only added when a media collection (`slugs.media`, default `'media'`) exists in the Payload config — installs without one simply omit this field (no init error) |
| `description` | Textarea | No | Service description |
| `duration` | Number | Yes | Duration in minutes (min: 1) |
| `durationType` | Select | Yes | `'fixed'`, `'flexible'`, or `'full-day'` (default: `'fixed'`) |
| `price` | Number | No | Price (min: 0, step: 0.01) |
| `bufferTimeBefore` | Number | No | Buffer minutes before the slot (default: 0, max: 1439) |
| `bufferTimeAfter` | Number | No | Buffer minutes after the slot (default: 0, max: 1439) |
| `resources` | Join | No | Read-only — resources that perform this service (join over `Resources.services`, `defaultLimit: 100`). Assigned on the Resource side; this field has no write affordance |
| `requiredResources` | Relationship | No | Extra resource pools (hasMany) auto-expanded into the reservation `items[]` at booking time |
| `allowGuestBooking` | Select | No | `'inherit'`, `'enabled'`, or `'disabled'` (default: `'inherit'`). Controls whether anonymous guest bookings are permitted for this service |
| `owner` | Relationship | Yes* | *Only present when `resourceOwnerMode.ownedServices` is enabled.* Owner of this service (sidebar). Defaults to the requesting user on create. Relates to `resourceOwnerMode.ownerCollection ?? staffProvisioning.userCollection ?? customers` (not a hardcoded customers slug) |
| `active` | Checkbox | No | Whether service is bookable (default: true) |

```typescript
await payload.create({
  collection: 'services',
  data: {
    name: 'Haircut',
    duration: 30,
    durationType: 'fixed',
    price: 35.00,
    bufferTimeBefore: 5,
    bufferTimeAfter: 10,
    active: true,
  },
})
```

See [Booking Features → Duration Types](./booking-features.md#duration-types) for how `durationType` affects end time calculation.

---

## Resources

**Slug:** `resources`

Who or what performs the service (a stylist, a room, a machine, a yoga instructor).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | Text | Yes | Resource name (max 200 chars) |
| `image` | Upload | No | Resource photo. Only added when a media collection (`slugs.media`, default `'media'`) exists in the Payload config — installs without one simply omit this field (no init error) |
| `description` | Textarea | No | Resource description |
| `services` | Relationship | No | Services this resource can perform (hasMany). Optional so freshly provisioned staff resources can exist before services are assigned |
| `active` | Checkbox | No | Whether resource accepts bookings (default: true) |
| `quantity` | Number | Yes | How many concurrent bookings allowed (default: 1) |
| `capacityMode` | Select | No | `'per-reservation'` or `'per-guest'` — shown only when `quantity > 1` |
| `timezone` | Text | No | **Deprecated / unused** — schedule resolution uses the plugin-level `timezone` option, not this field |
| `resourceType` | Select | No | Descriptive resource category. Options come from the `resourceTypes` config (default `['staff','equipment','room']`); defaults to the first entry (`'staff'`). Drives no logic |
| `owner` | Relationship | Yes* | *Only present when `resourceOwnerMode` is enabled.* Owner of this resource (sidebar). Defaults to the requesting user on create. Relates to `resourceOwnerMode.ownerCollection ?? staffProvisioning.userCollection ?? customers` |

```typescript
await payload.create({
  collection: 'resources',
  data: {
    name: 'Room 101',
    services: [conferenceServiceId],
    quantity: 1,
    active: true,
  },
})
```

See [Booking Features → Capacity and Inventory](./booking-features.md#capacity-and-inventory) for how `quantity` and `capacityMode` work together.

---

## Schedules

**Slug:** `schedules`

Defines when a resource is available. Supports **recurring** (weekly pattern) and **manual** (specific dates) types, plus exception dates.

| Field | Type | Description |
|-------|------|-------------|
| `name` | Text | Schedule name |
| `resource` | Relationship | Which resource this schedule belongs to |
| `scheduleType` | Select | `'recurring'` or `'manual'` (default: `'recurring'`) |
| `recurringSlots` | Array | Weekly slots with `day`, `startTime`, `endTime` |
| `manualSlots` | Array | Specific date slots with `date`, `startTime`, `endTime` |
| `exceptions` | Array | Dates the resource is unavailable. Each: `date` (required), `endDate` (optional — makes a full inclusive date range), `type` (select from `leaveTypes` config, default `['vacation','sick','personal','closure','other']`), `reason` (text) |
| `active` | Checkbox | Whether this schedule is in effect (default: true) |

Times use `HH:mm` format (24-hour, e.g., `09:00`, `17:30`). The format is validated — values like `9:00` (missing leading zero) or `09:00:00` (with seconds) are rejected. Within each slot, `endTime` must be after `startTime`. Any date inside an exception (including a `date`–`endDate` range, where `endDate` must be on or after `date`) blocks out that entire day.

```typescript
await payload.create({
  collection: 'schedules',
  data: {
    name: 'Alice - Standard Week',
    resource: aliceId,
    scheduleType: 'recurring',
    recurringSlots: [
      { day: 'mon', startTime: '09:00', endTime: '17:00' },
      { day: 'tue', startTime: '09:00', endTime: '17:00' },
      { day: 'wed', startTime: '09:00', endTime: '17:00' },
      { day: 'thu', startTime: '09:00', endTime: '17:00' },
      { day: 'fri', startTime: '09:00', endTime: '15:00' },
    ],
    exceptions: [
      { date: '2025-12-25', reason: 'Christmas', type: 'closure' },
      // A multi-day range (inclusive): the resource is off all week
      { date: '2025-07-01', endDate: '2025-07-07', reason: 'Vacation', type: 'vacation' },
    ],
    active: true,
  },
})
```

---

## Customers

**Slug:** `customers` (or your `userCollection` slug)

Either a standalone auth collection (default) or fields injected into your existing auth collection when `userCollection` is set.

### Standalone Mode (default)

A dedicated auth collection with `auth: true` for customer JWT login. Has `access.admin: () => false` to block customers from the admin panel.

### User Collection Mode (`userCollection` set)

The plugin injects `name`, `phone`, `notes`, and a `bookings` join field into your existing auth collection — each only if a field with that name isn't already present. No new collection is created. The resolved `slugs.customers` points at the user collection so all downstream code uses the correct slug. Note: the injected `name` is **not** required here, so existing users without a name can still be updated.

Field deduplication prevents double-injection — the plugin checks each field's `name` before injecting, so if your collection already defines `name` (or any of the others) the existing field config wins. Deduplication descends into presentational containers (tabs, rows, collapsibles, unnamed groups), so a `name` nested inside one of them won't be re-injected at the top level.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `email` | Email | Customer email (from Payload auth) |
| `firstName` | Text | First name (standalone mode only) |
| `lastName` | Text | Last name (standalone mode only) |
| `name` | Text | Customer name (max 200 chars; required in standalone mode, optional when injected into a user collection). Injected into the user collection so `admin.useAsTitle: 'name'` works out of the box |
| `phone` | Text | Phone number (max 50 chars) |
| `notes` | Textarea | Internal notes visible only to admins |
| `bookings` | Join | Virtual field — all reservations for this customer |

---

## Reservations

**Slug:** `reservations`

The core booking records. Each reservation links a service performed by a resource to either a registered customer or an anonymous guest.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | Relationship | Yes | Service being booked |
| `resource` | Relationship | Yes | Resource performing the service |
| `customer` | Relationship | No | Customer making the booking. Optional — bookings may instead capture an anonymous `guest`. Uses a custom CustomerField admin component with inline create/edit |
| `guest` | Group | No | Anonymous guest details: `name` (text, max 200), `email` (email), `phone` (text, max 50). Used when no `customer` is set |
| `cancellationToken` | Text | No | Hidden, indexed token for self-service (guest) cancellation. Server-generated only — create and update access are denied, so it can never be set via the API. Read access restricted to staff/admin (non-customer users); never returned by the public API |
| `startTime` | Date | Yes | Appointment start (availability-aware slot picker) |
| `endTime` | Date | No | Editable. Auto-calculated from service duration and overwritten on save for `fixed`/`full-day` services; for `flexible`-duration services the caller/admin supplies it (required, must be after `startTime`) |
| `status` | Select | No | Workflow status (default: `'pending'`) |
| `guestCount` | Number | No | Number of guests (default: 1, min: 1) |
| `cancellationReason` | Textarea | No | Visible only when status is `'cancelled'` |
| `notes` | Textarea | No | Additional notes |
| `items` | Array | No | Multi-resource booking lines. Each item: `resource` (relationship, required), `service` (relationship, optional), `startTime` (date, optional), `endTime` (date, optional), `guestCount` (number, optional, min 1). Missing values inherit the parent reservation |
| `idempotencyKey` | Text | No | Unique key to prevent duplicate submissions (sidebar, read-only) |

A reservation must have **either** a `customer` **or** a `guest` — not both, not neither (enforced by the `validateGuestBooking` hook, gated by `allowGuestBooking`). See [Booking Features → Multi-Resource Bookings](./booking-features.md#multi-resource-bookings) for the `items` array and [Guest Bookings](../README.md#guest-bookings) for account-less bookings.

---

← [Configuration](./configuration.md) | → [Status Machine](./status-machine.md) | ↑ [Back to README](../README.md)

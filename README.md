# payload-reserve

[![npm version](https://img.shields.io/npm/v/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![npm downloads](https://img.shields.io/npm/dm/payload-reserve.svg)](https://www.npmjs.com/package/payload-reserve)
[![license](https://img.shields.io/npm/l/payload-reserve.svg)](./LICENSE)

A full-featured reservation and booking plugin for Payload CMS 3.x. Adds a scheduling system with conflict detection, a configurable status machine, multi-resource bookings, capacity and inventory tracking, a public REST API, and admin UI components.

Designed for salons, clinics, hotels, restaurants, event venues, and any business that needs appointment scheduling managed through Payload's admin panel.

📦 **npm:** https://www.npmjs.com/package/payload-reserve

---

## Features

- **5 Domain Collections** — Services, Resources, Schedules, Reservations, and Customers (standalone or user-collection extension)
- **User Collection Extension** — Optionally extend your existing auth collection with booking fields; set `userCollection: undefined` (default) to use a standalone Customers collection
- **Resource Owner Multi-Tenancy** — Opt-in `resourceOwnerMode` wires ownership access control so each resource owner (host) sees only their own listings and reservations
- **Configurable Status Machine** — Define your own statuses, transitions, blocking states, and terminal states
- **Double-Booking Prevention** — Server-side conflict detection with per-item buffer times; respects capacity modes
- **Auto End Time** — Calculates `endTime` from `startTime + service.duration` automatically
- **Three Duration Types** — `fixed` (service duration), `flexible` (customer-specified end), and `full-day` bookings
- **Multi-Resource Bookings** — Single reservation that spans multiple resources simultaneously via the `items` array
- **Capacity and Inventory** — `quantity > 1` allows multiple concurrent bookings per resource; `capacityMode` (`per-reservation` | `per-guest`) controls how capacity is counted
- **Idempotency** — Optional `idempotencyKey` prevents duplicate submissions
- **Extra Reservation Fields** — Inject custom fields into the Reservations collection via `extraReservationFields` without forking the plugin
- **Cancellation Policy** — Configurable minimum notice period enforcement
- **Plugin Hooks API** — Seven lifecycle hooks (`beforeBookingCreate`, `afterBookingCreate`, `beforeBookingConfirm`, `afterBookingConfirm`, `beforeBookingCancel`, `afterBookingCancel`, `afterStatusChange`) for integrating email, Stripe, and external systems
- **Availability Service** — Pure functions and DB helpers for slot generation (15-min step) and conflict checking with guest-count-aware filtering
- **Public REST API** — Five pre-built endpoints for availability, slot listing, booking, cancellation, and customer search — with ownership enforcement and input validation
- **Calendar View** — Month/week/day calendar replacing the default reservations list view
- **Dashboard Widget** — Server component showing today's booking stats
- **Availability Overview** — Weekly grid of resource availability vs. booked slots
- **Recurring and Manual Schedules** — Weekly patterns with exception dates, or specific one-off dates
- **Localization Support** — Collection fields can be localized when Payload localization is enabled
- **Type-Safe** — Full TypeScript support with exported types

---

## Install

```bash
pnpm add payload-reserve
# or
npm install payload-reserve
```

**Peer dependencies:** `payload ^3.79.0`, `@payloadcms/ui ^3.79.0`, `@payloadcms/translations ^3.79.0`

---

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'

export default buildConfig({
  collections: [/* your collections */],
  plugins: [
    payloadReserve(),
  ],
})
```

---

## Resource Owner Multi-Tenancy

Enable `resourceOwnerMode` to support Airbnb-style platforms where each user manages their own listings (Resources) and sees only the reservations made against them. This is opt-in — single-tenant installs are unaffected.

```typescript
payloadReserve({
  userCollection: 'users',       // required: which auth collection holds owners
  resourceOwnerMode: {
    adminRoles: ['admin'],        // roles that bypass all filters (see all records)
    ownerField: 'owner',          // field name added to Resources (default: 'owner')
    ownedServices: false,         // set true if Services should also be owner-scoped
  },
})
```

**What this does automatically:**

| Collection | Behaviour |
|------------|-----------|
| Resources | Adds an `owner` relationship field (auto-populated on create); owners read/update/delete only their own records |
| Schedules | Owners read/update/delete only schedules whose resource they own (join through `resource.owner`) |
| Reservations | Owners can read reservations for their resources; mutations are admin-only |
| Services | Unchanged by default; set `ownedServices: true` to apply the same owner pattern |

The `access` override in plugin config always takes precedence over the auto-wired functions, so you can fine-tune any collection without losing the rest.

---

## Staff Scheduling

### Staff Auto-Provisioning

Enable `staffProvisioning` to automatically create an owner-scoped Resource whenever a user gains a staff role. Requires `resourceOwnerMode`.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'],
  },
  staffProvisioning: {
    staffRoles: ['staff', 'therapist'],  // roles that trigger auto-provisioning
    roleField: 'role',                   // field on the user doc (default: 'role')
    resourceType: 'staff',               // resourceType stamped on the new Resource (default: 'staff')
    nameFrom: 'name',                    // user field to use as Resource name (default: 'name', falls back to email)
  },
})
```

**Use `beforeCreate` to stamp tenant IDs or custom fields** before the Resource is saved:

```typescript
staffProvisioning: {
  staffRoles: ['staff'],
  beforeCreate: ({ data, user }) => ({
    ...data,
    tenant: user.tenant,   // forward the user's tenant to the new Resource
  }),
},
```

**Key behaviours:**

- **Idempotent** — deduplicates by owner; creating or re-saving a staff user never creates a second Resource.
- **Non-blocking** — provisioning failures are logged and do not prevent user creation or update.
- **Impersonation-based ownership** — the Resource is created as the new staff user, so `resource.owner` is always the user themselves (no ownership-bypass flag).
- **No auto-delete on demotion** — removing a staff role from a user does not delete their Resource.

### Full-Day-Range Time-Off

Schedule exceptions now support a date range and a leave type:

```typescript
// Schedule.exceptions[] — each entry can have:
{
  date: '2025-12-25',   // start date (always required)
  endDate: '2025-12-26', // optional range end, inclusive
  type: 'vacation',      // optional leave category
}
```

Any date falling within the range (inclusive) makes the resource fully unavailable for that day. This powers multi-day leave entries for staff schedules.

### Configurable Vocabularies

Customize the option lists for resource types and leave types:

```typescript
payloadReserve({
  resourceTypes: ['staff', 'room', 'equipment', 'vehicle'],  // default: ['staff','equipment','room']
  leaveTypes: ['vacation', 'sick', 'training', 'closure'],   // default: ['vacation','sick','personal','closure','other']
})
```

The first entry of `resourceTypes` becomes the default value for the `Resource.resourceType` field.

### Optional `Resource.services`

The `services` relationship on Resources is now optional. This lets a freshly provisioned staff Resource exist before services are assigned, avoiding validation errors during auto-provisioning.

---

## Documentation

> The docs below live in the [GitHub repository](https://github.com/elghaied/payload-reserve/tree/main/docs) and are not included in the published npm package.

| Topic | Contents |
|-------|----------|
| [Getting Started](https://github.com/elghaied/payload-reserve/blob/main/docs/getting-started.md) | Installation, quick start, what gets created |
| [Configuration](https://github.com/elghaied/payload-reserve/blob/main/docs/configuration.md) | All plugin options with types and defaults, including `resourceOwnerMode` |
| [Collections](https://github.com/elghaied/payload-reserve/blob/main/docs/collections.md) | Services, Resources, Schedules, Customers, Reservations schemas |
| [Status Machine](https://github.com/elghaied/payload-reserve/blob/main/docs/status-machine.md) | Default flow, custom machines, business logic hooks, escape hatch |
| [Booking Features](https://github.com/elghaied/payload-reserve/blob/main/docs/booking-features.md) | Duration types, multi-resource bookings, capacity modes |
| [Hooks API](https://github.com/elghaied/payload-reserve/blob/main/docs/hooks-api.md) | All 7 plugin hook types with signatures and examples |
| [REST API](https://github.com/elghaied/payload-reserve/blob/main/docs/rest-api.md) | All 5 public endpoints with params, responses, and fetch examples |
| [Admin UI](https://github.com/elghaied/payload-reserve/blob/main/docs/admin-ui.md) | Calendar view, dashboard widget, availability overview |
| [Examples](https://github.com/elghaied/payload-reserve/blob/main/docs/examples.md) | Salon, hotel, restaurant, event venue, Stripe, email, multi-tenant (resource owner mode) |
| [Advanced](https://github.com/elghaied/payload-reserve/blob/main/docs/advanced.md) | DB indexes, reconciliation job for race condition detection |
| [Development](https://github.com/elghaied/payload-reserve/blob/main/docs/development.md) | Prerequisites, commands, project file tree |
| [v1.2.0 Breaking Changes](https://github.com/elghaied/payload-reserve/blob/main/docs/BREAKING-CHANGES-v1.2.md) | Migration guide for upgrading to v1.2.0 |

---

## Contributing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

When making a change that should appear in the release notes, run:

```bash
pnpm changeset
```

This prompts for the semver bump type (patch/minor/major) and a summary. Commit the generated changeset file with your PR.

**Releasing:**

```bash
pnpm changeset:version   # consume changesets, bump version, update CHANGELOG.md
git add -A && git commit -m "release v<version>"
git tag v<version>
git push && git push --tags
```

The GitHub Action will create a release with the changelog content and publish to npm.

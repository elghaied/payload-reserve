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
- **Configurable Status Machine** — Define your own statuses, transitions, blocking states, terminal states, and the `confirmStatus`/`cancelStatus` that drive the confirm/cancel hooks and cancellation policy
- **Double-Booking Prevention** — Server-side conflict detection that enforces both bookings' buffer times and checks each resource only for its own item window; respects capacity modes
- **Business Timezone** — Set a plugin-level `timezone` (IANA, default `'UTC'`) so schedules, day boundaries, and the admin calendar resolve in your business's timezone regardless of server location
- **Auto End Time** — Calculates `endTime` from `startTime + service.duration` automatically
- **Three Duration Types** — `fixed` (service duration), `flexible` (customer-specified end), and `full-day` bookings
- **Multi-Resource Bookings** — Single reservation that spans multiple resources simultaneously via the `items` array
- **Capacity and Inventory** — `quantity > 1` allows multiple concurrent bookings per resource; `capacityMode` (`per-reservation` | `per-guest`) controls how capacity is counted
- **Guest Bookings** — Account-less reservations with inline contact details (name + email/phone); `allowGuestBooking` plugin option and per-service `inherit`/`enabled`/`disabled` override; guests receive a `cancellationToken` via the `afterBookingCreate` hook for cancel-link delivery
- **Idempotency** — Optional `idempotencyKey` prevents duplicate submissions
- **Collection Overrides** — Customize any generated collection (add fields like a `join`, tweak admin options, attach your own hooks) via `collectionOverrides` without forking — the plugin's hooks and access are merged, not clobbered (supersedes the deprecated `extraReservationFields`)
- **Cancellation Policy** — Configurable minimum notice period enforcement
- **Plugin Hooks API** — Seven lifecycle hooks (`beforeBookingCreate`, `afterBookingCreate`, `beforeBookingConfirm`, `afterBookingConfirm`, `beforeBookingCancel`, `afterBookingCancel`, `afterStatusChange`) for integrating email, Stripe, and external systems
- **Availability Service** — Pure functions and DB helpers for slot generation (15-min step) and conflict checking with guest-count-aware filtering
- **Public REST API** — Six pre-built endpoints for availability, slot listing, resource availability, booking (incl. guest bookings), cancellation, and customer search — with ownership enforcement and input validation
- **Calendar View** — Month/week/day/lanes/pending calendar replacing the default reservations list view, with per-resource availability shading and click-a-free-slot-to-book; plus an availability-aware slot picker on the reservation form
- **Dashboard Widget** — Server component showing today's booking stats
- **Availability Overview** — Weekly grid of resource availability vs. booked slots
- **Recurring and Manual Schedules** — Weekly patterns with exception dates, or specific one-off dates
- **12 Bundled Languages** — Every admin string is translatable; ships with English, French, German, Spanish, Russian, Polish, Turkish, Arabic, Simplified Chinese, Indonesian, Persian/Farsi, and Hindi. Override any string or add your own language
- **Localization Support** — Collection field *content* can be localized when Payload localization is enabled (separate from the admin-UI language above)
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

## Guest Bookings

Enable `allowGuestBooking` to accept reservations from users who don't have a customer account. Guests provide inline contact details (name + email or phone) instead of linking to a customer record.

```typescript
payloadReserve({
  allowGuestBooking: true,   // enable guest bookings globally (default: false)
})
```

### Per-service override

Each Service has its own `allowGuestBooking` select field that overrides the plugin-level default:

| Value | Behaviour |
|-------|-----------|
| `inherit` | Use the plugin-level `allowGuestBooking` value *(default)* |
| `enabled` | Allow guest bookings for this service regardless of the global setting |
| `disabled` | Require a customer account for this service regardless of the global setting |

> **Note:** For multi-resource bookings (the `items` array), the guest-booking gate is evaluated against the reservation's top-level `service`. Per-item service overrides are not individually enforced.

### Customer vs. guest

The `customer` relationship field on Reservations is now **optional**. A reservation must have **either** a `customer` **or** a `guest` block — not both, not neither.

The `guest` block requires `name` and at least one of `email` or `phone`:

```typescript
// POST /api/reserve/book
{
  "service": "...",
  "resource": "...",
  "startTime": "2026-06-01T10:00:00.000Z",
  "guest": {
    "name": "Jane Smith",
    "email": "jane@example.com"   // or "phone": "+1-555-0100"
  }
}
```

### Cancellation token

When a guest booking is created the plugin generates a `cancellationToken` (random UUID). It is **not** returned in the `/api/reserve/book` HTTP response. It is exposed server-side via the `afterBookingCreate` plugin hook so the host project can deliver a cancel link by email or an SMS code:

```typescript
payloadReserve({
  allowGuestBooking: true,
  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        if (doc.guest && doc.cancellationToken) {
          // Send the token however you like — the plugin sends nothing itself
          await sendEmail({
            to: doc.guest.email,
            cancelUrl: `https://example.com/cancel?reservationId=${doc.id}&token=${doc.cancellationToken}`,
          })
        }
      },
    ],
  },
})
```

To cancel with the token, POST to `/api/reserve/cancel` without authentication:

```typescript
// POST /api/reserve/cancel
{
  "reservationId": "...",
  "token": "<cancellationToken>"
}
```

Authenticated owner/admin cancellation (without a token) is unchanged.

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

### Business Timezone

Set a plugin-level `timezone` (IANA name, default `'UTC'`) to govern all schedule resolution — what `HH:mm` schedule times mean, which calendar day a `date=YYYY-MM-DD` query maps to, exception-day matching, and full-day booking boundaries:

```typescript
payloadReserve({
  timezone: 'America/New_York',  // default: 'UTC'
})
```

Without this, day resolution mixes server-local and UTC semantics — on non-UTC servers the slots API can resolve the wrong calendar day. With `timezone` set, all server-side day math runs via the built-in `Intl` API (no extra dependency). `'UTC'` on a UTC server is identical to the previous behaviour. The configured timezone is exposed to admin components via `config.admin.custom.reservationTimezone`.

### Collection Overrides

Customize any generated collection without forking the plugin via `collectionOverrides`. Each entry is a `Partial<CollectionConfig>` (minus `fields`/`slug`) plus a `fields` function that receives the plugin's default fields:

```typescript
payloadReserve({
  collectionOverrides: {
    services: {
      // append a join field back to Resources (the inverse of Resources.services)
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

The plugin's load-bearing behavior is protected: supplied `hooks` are **merged** (the plugin's conflict-detection/status hooks always run, and run first — an override can add hooks but not remove them), `access` **composes** per operation (rules you omit keep the plugin's owner-mode/default behavior), and `slug` is ignored (use the `slugs` option). The `customers` override applies only when the standalone Customers collection is generated (ignored when `userCollection` is set — your auth collection is yours to edit directly). `collectionOverrides` supersedes the deprecated `extraReservationFields`.

### Optional `Resource.services`

The `services` relationship on Resources is now optional. This lets a freshly provisioned staff Resource exist before services are assigned, avoiding validation errors during auto-provisioning.

---

## Internationalization

Every admin string the plugin renders — field labels, descriptions, select options, calendar/dashboard components, and validation errors — is translatable. The plugin ships **12 languages**: English, French (`fr`), German (`de`), Spanish (`es`), Russian (`ru`), Polish (`pl`), Turkish (`tr`), Arabic (`ar`), Simplified Chinese (`zh`), Indonesian (`id`), Persian/Farsi (`fa`), and Hindi (`hi`). All but Hindi ship in Payload core and appear in the admin language switcher automatically.

Translations merge into your config and **your translations take precedence**, so you can override any string or add a language:

```typescript
payloadReserve()
// and in buildConfig:
i18n: {
  translations: {
    en: { reservation: { calendarLanes: 'Timeline' } }, // override a plugin string
  },
}
```

> **Hindi** (`hi`) is not bundled by Payload core, so register it as a custom language in your Payload `i18n` config to make it selectable — the plugin's `hi` strings then appear automatically. See the [Internationalization docs](https://github.com/elghaied/payload-reserve/blob/main/docs/i18n.md).

This is separate from Payload **field localization** (localizing the *content* of fields), which the plugin's fields also support when Payload localization is enabled.

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
| [REST API](https://github.com/elghaied/payload-reserve/blob/main/docs/rest-api.md) | All 6 public endpoints with params, responses, and fetch examples |
| [Admin UI](https://github.com/elghaied/payload-reserve/blob/main/docs/admin-ui.md) | Calendar view, dashboard widget, availability overview |
| [Internationalization](https://github.com/elghaied/payload-reserve/blob/main/docs/i18n.md) | 12 bundled languages, overriding strings, adding a language, Hindi setup |
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

# Configuration Reference

Full reference for all `payloadReserve()` plugin options. All options are optional.

## Full Config Example

```typescript
import { payloadReserve } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'

payloadReserve({
  disabled: false,
  adminGroup: 'Reservations',
  defaultBufferTime: 0,
  cancellationNoticePeriod: 24,
  userCollection: 'users',

  slugs: {
    services: 'services',
    resources: 'resources',
    schedules: 'schedules',
    reservations: 'reservations',
    customers: 'customers',
    media: 'media',
  },

  access: {
    services: {
      read: () => true,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
    },
    resources: { read: () => true },
    schedules: { read: () => true },
    reservations: { create: () => true },
    customers: { create: () => true },
  },

  statusMachine: {
    statuses: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    defaultStatus: 'pending',
    terminalStatuses: ['completed', 'cancelled', 'no-show'],
    blockingStatuses: ['pending', 'confirmed'],
    transitions: {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled', 'no-show'],
      completed: [],
      cancelled: [],
      'no-show': [],
    },
  },

  hooks: {
    afterBookingCreate: [
      async ({ doc, req }) => {
        // Send confirmation email, etc.
      },
    ],
  },

  // Extra fields appended to the Reservations collection
  extraReservationFields: [
    { name: 'paymentReminderSent', type: 'checkbox', defaultValue: false },
  ],

  // Opt-in resource owner multi-tenancy
  resourceOwnerMode: {
    adminRoles: ['admin'],
    ownerField: 'owner',
    ownedServices: false,
  },
})
```

## Defaults Table

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable plugin |
| `adminGroup` | `string` | `'Reservations'` | Admin panel group label |
| `defaultBufferTime` | `number` | `0` | Default buffer between bookings (minutes) |
| `cancellationNoticePeriod` | `number` | `24` | Minimum hours notice for cancellation |
| `userCollection` | `string` | `undefined` | Existing auth collection slug to extend |
| `slugs.services` | `string` | `'services'` | Services collection slug |
| `slugs.resources` | `string` | `'resources'` | Resources collection slug |
| `slugs.schedules` | `string` | `'schedules'` | Schedules collection slug |
| `slugs.reservations` | `string` | `'reservations'` | Reservations collection slug |
| `slugs.customers` | `string` | `'customers'` | Customers collection slug |
| `slugs.media` | `string` | `'media'` | Media collection slug |
| `statusMachine` | `Partial<StatusMachineConfig>` | Default 5-status machine | Custom status machine |
| `hooks` | `ReservationPluginHooks` | `{}` | Plugin hook callbacks |
| `extraReservationFields` | `Field[]` | `[]` | Extra Payload fields appended to Reservations |
| `resourceOwnerMode` | `ResourceOwnerModeConfig` | `undefined` | Opt-in multi-tenant owner mode |
| `resourceOwnerMode.adminRoles` | `string[]` | `[]` | Roles that bypass owner filters |
| `resourceOwnerMode.ownerField` | `string` | `'owner'` | Field name for owner relationship |
| `resourceOwnerMode.ownedServices` | `boolean` | `false` | Whether Services also get owner scoping |

## userCollection Notes

- When set: injects `phone`, `notes`, and `bookings` join into that collection; no standalone Customers collection is created
- When unset (default): creates a standalone `customers` auth collection
- The named collection must already exist in your Payload config before the plugin runs
- `slugs.customers` is automatically remapped to the user collection slug

## access Notes

Access functions follow Payload's standard access control signature `({ req }) => boolean | Where`.
You can return a `Where` clause to scope access (useful for multi-tenant setups).

## resourceOwnerMode Notes

Opt-in feature for Airbnb-style platforms where each user manages their own resources.

When enabled (`resourceOwnerMode: { ... }`):

| Collection | Behaviour |
|------------|-----------|
| Resources | Adds an `owner` relationship field (auto-populated on create); owners read/update/delete only their own |
| Schedules | Owners read/update/delete only schedules whose resource they own (via `resource.owner`) |
| Reservations | Owners can read reservations for their resources; mutations are admin-only |
| Services | Unchanged by default; set `ownedServices: true` to apply the same owner pattern |

- `adminRoles` — roles that bypass all owner filters (see all records); if empty, no role-based bypass
- `ownerField` — field name added to Resources (default: `'owner'`)
- `ownedServices` — set `true` to also scope Services by owner
- The `access` override in plugin config always takes precedence over auto-wired functions

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'],
    ownerField: 'owner',
    ownedServices: false,
  },
})
```

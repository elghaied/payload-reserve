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

## userCollection Notes

- When set: injects `phone`, `notes`, and `bookings` join into that collection; no standalone Customers collection is created
- When unset (default): creates a standalone `customers` auth collection
- The named collection must already exist in your Payload config before the plugin runs
- `slugs.customers` is automatically remapped to the user collection slug

## access Notes

Access functions follow Payload's standard access control signature `({ req }) => boolean | Where`.
You can return a `Where` clause to scope access (useful for multi-tenant setups).

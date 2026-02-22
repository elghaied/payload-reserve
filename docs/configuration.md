# Configuration

Full reference for all `payloadReserve()` plugin options.

All options are optional — the plugin works with sensible defaults.

## Full Config Example

```typescript
import { payloadReserve } from 'payload-reserve'
import type { ReservationPluginConfig } from 'payload-reserve'

payloadReserve({
  // Disable the plugin entirely while keeping the config type-safe
  disabled: false,

  // Admin group label for all reservation collections
  adminGroup: 'Reservations',

  // Minutes of buffer between reservations when a service has none defined
  defaultBufferTime: 0,

  // Minimum hours of notice required before a cancellation is allowed
  cancellationNoticePeriod: 24,

  // Extend an existing auth collection instead of creating a standalone Customers collection.
  // The named collection must exist in your Payload config before the plugin runs.
  userCollection: 'users',

  // Override collection slugs
  slugs: {
    services: 'services',
    resources: 'resources',
    schedules: 'schedules',
    reservations: 'reservations',
    customers: 'customers',
    media: 'media',
  },

  // Override access control per collection
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

  // Configurable status machine
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

  // Plugin hook callbacks — see hooks-api.md
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
})
```

## Defaults Table

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable plugin functionality |
| `adminGroup` | `string` | `'Reservations'` | Admin panel group label |
| `defaultBufferTime` | `number` | `0` | Default buffer between bookings (minutes) |
| `cancellationNoticePeriod` | `number` | `24` | Minimum hours notice for cancellation |
| `userCollection` | `string` | `undefined` | Existing auth collection slug to extend |
| `slugs.services` | `string` | `'services'` | Services collection slug |
| `slugs.resources` | `string` | `'resources'` | Resources collection slug |
| `slugs.schedules` | `string` | `'schedules'` | Schedules collection slug |
| `slugs.reservations` | `string` | `'reservations'` | Reservations collection slug |
| `slugs.customers` | `string` | `'customers'` | Customers collection slug |
| `slugs.media` | `string` | `'media'` | Media collection slug (used by image fields) |
| `statusMachine` | `Partial<StatusMachineConfig>` | Default 5-status machine | Custom status machine |
| `hooks` | `ReservationPluginHooks` | `{}` | Plugin hook callbacks |
| `extraReservationFields` | `Field[]` | `[]` | Extra Payload fields appended to the Reservations collection |

---

← [Getting Started](./getting-started.md) | → [Collections](./collections.md) | ↑ [Back to README](../README.md)

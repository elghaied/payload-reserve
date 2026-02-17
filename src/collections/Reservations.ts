import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionConfig,
} from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ReservationPluginHooks, ResolvedReservationPluginConfig } from '../types.js'

import { calculateEndTime } from '../hooks/reservations/calculateEndTime.js'
import { checkIdempotency } from '../hooks/reservations/checkIdempotency.js'
import { onStatusChange } from '../hooks/reservations/onStatusChange.js'
import { validateCancellation } from '../hooks/reservations/validateCancellation.js'
import { validateConflicts } from '../hooks/reservations/validateConflicts.js'
import { validateStatusTransition } from '../hooks/reservations/validateStatusTransition.js'

function createPluginHooksBeforeCreate(
  hooks: ReservationPluginHooks,
): CollectionBeforeChangeHook {
  return async ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks) {return data}

    if (operation === 'create' && hooks.beforeBookingCreate) {
      let mutatedData = data
      for (const hook of hooks.beforeBookingCreate) {
        const result = await hook({ data: mutatedData, req })
        if (result) {mutatedData = result}
      }
      return mutatedData
    }

    return data
  }
}

function createPluginHooksAfterCreate(
  hooks: ReservationPluginHooks,
): CollectionAfterChangeHook {
  return async ({ doc, operation, req }) => {
    if (operation === 'create' && hooks.afterBookingCreate) {
      const docRecord = doc as Record<string, unknown>
      for (const hook of hooks.afterBookingCreate) {
        await hook({ doc: docRecord, req })
      }
    }
    return doc
  }
}

export function createReservationsCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  const { statusMachine } = config

  return {
    slug: config.slugs.reservations,
    access: config.access.reservations ?? {},
    admin: {
      components: {
        views: {
          list: {
            Component: 'payload-reserve/client#CalendarView',
          },
        },
      },
      group: config.adminGroup,
      listSearchableFields: ['status'],
      useAsTitle: 'startTime',
    },
    fields: [
      {
        name: 'service',
        type: 'relationship',
        label: ({ t }) => (t as PluginT)('reservation:fieldService'),
        relationTo: config.slugs.services,
        required: true,
      },
      {
        name: 'resource',
        type: 'relationship',
        label: ({ t }) => (t as PluginT)('reservation:fieldResource'),
        relationTo: config.slugs.resources,
        required: true,
      },
      {
        name: 'customer',
        type: 'relationship',
        admin: {
          allowCreate: true,
          allowEdit: true,
          components: {
            Field: 'payload-reserve/client#CustomerField',
          },
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldCustomer'),
        relationTo: config.slugs.customers,
        required: true,
      },
      {
        name: 'startTime',
        type: 'date',
        admin: {
          date: {
            pickerAppearance: 'dayAndTime',
          },
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldStartTime'),
        required: true,
      },
      {
        name: 'endTime',
        type: 'date',
        admin: {
          date: {
            pickerAppearance: 'dayAndTime',
          },
          readOnly: true,
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldEndTime'),
      },
      {
        name: 'status',
        type: 'select',
        defaultValue: statusMachine.defaultStatus,
        label: ({ t }) => (t as PluginT)('reservation:fieldStatus'),
        options: statusMachine.statuses.map((s) => ({
          label: ({ t }) => {
            const key = `reservation:status${s.charAt(0).toUpperCase() + s.slice(1)}`
            const translated = (t as PluginT)(key as Parameters<PluginT>[0])
            return translated !== key ? translated : s.charAt(0).toUpperCase() + s.slice(1)
          },
          value: s,
        })),
      },
      {
        name: 'cancellationReason',
        type: 'textarea',
        admin: {
          condition: (_, siblingData) => siblingData?.status === 'cancelled',
        },
        label: ({ t }) => (t as PluginT)('reservation:fieldCancellationReason'),
      },
      {
        name: 'guestCount',
        type: 'number',
        defaultValue: 1,
        label: ({ t }) => (t as PluginT)('reservation:fieldGuestCount'),
        min: 1,
      },
      {
        name: 'notes',
        type: 'textarea',
        label: ({ t }) => (t as PluginT)('reservation:fieldNotes'),
      },
      {
        name: 'items',
        type: 'array',
        admin: {
          description: 'Resources included in this booking. Leave empty for single-resource bookings.',
        },
        fields: [
          {
            name: 'resource',
            type: 'relationship',
            label: ({ t }) => (t as PluginT)('reservation:fieldResource'),
            relationTo: config.slugs.resources,
            required: true,
          },
          {
            name: 'service',
            type: 'relationship',
            label: ({ t }) => (t as PluginT)('reservation:fieldService'),
            relationTo: config.slugs.services,
          },
          {
            name: 'startTime',
            type: 'date',
            admin: { date: { pickerAppearance: 'dayAndTime' } },
            label: ({ t }) => (t as PluginT)('reservation:fieldStartTime'),
          },
          {
            name: 'endTime',
            type: 'date',
            admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: false },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndTime'),
          },
          {
            name: 'guestCount',
            type: 'number',
            label: ({ t }) => (t as PluginT)('reservation:fieldGuestCount'),
            min: 1,
          },
        ],
        label: ({ t }) => (t as PluginT)('reservation:fieldItems'),
      },
      {
        name: 'idempotencyKey',
        type: 'text',
        admin: { position: 'sidebar', readOnly: true },
        index: true,
        unique: true,
      },
    ],
    hooks: {
      afterChange: [
        createPluginHooksAfterCreate(config.hooks),
        onStatusChange(config),
      ],
      beforeChange: [
        createPluginHooksBeforeCreate(config.hooks),
        checkIdempotency(config),
        calculateEndTime(config),
        validateConflicts(config),
        validateStatusTransition(config),
        validateCancellation(config),
      ],
    },
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
    },
  }
}

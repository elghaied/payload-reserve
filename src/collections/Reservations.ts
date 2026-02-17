import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionConfig,
} from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ReservationPluginHooks, ResolvedReservationPluginConfig } from '../types.js'

import { calculateEndTime } from '../hooks/reservations/calculateEndTime.js'
import { validateCancellation } from '../hooks/reservations/validateCancellation.js'
import { validateConflicts } from '../hooks/reservations/validateConflicts.js'
import { validateStatusTransition } from '../hooks/reservations/validateStatusTransition.js'

function createPluginHooksBeforeChange(
  hooks: ReservationPluginHooks,
): CollectionBeforeChangeHook {
  return async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    if (operation === 'create' && hooks.beforeBookingCreate) {
      let mutatedData = data
      for (const hook of hooks.beforeBookingCreate) {
        const result = await hook({ data: mutatedData, req })
        if (result) {mutatedData = result}
      }
      return mutatedData
    }

    if (operation === 'update') {
      const previousStatus = (originalDoc as Record<string, unknown>)?.status as
        | string
        | undefined
      const newStatus = data?.status as string | undefined

      if (previousStatus && newStatus && previousStatus !== newStatus) {
        if (newStatus === 'confirmed' && hooks.beforeBookingConfirm) {
          for (const hook of hooks.beforeBookingConfirm) {
            await hook({
              doc: originalDoc as Record<string, unknown>,
              newStatus,
              req,
            })
          }
        }
        if (newStatus === 'cancelled' && hooks.beforeBookingCancel) {
          for (const hook of hooks.beforeBookingCancel) {
            await hook({
              doc: originalDoc as Record<string, unknown>,
              reason: data?.cancellationReason as string | undefined,
              req,
            })
          }
        }
      }
    }

    return data
  }
}

function createPluginHooksAfterChange(
  hooks: ReservationPluginHooks,
): CollectionAfterChangeHook {
  return async ({ doc, operation, previousDoc, req }) => {
    const docRecord = doc as Record<string, unknown>

    if (operation === 'create') {
      if (hooks.afterBookingCreate) {
        for (const hook of hooks.afterBookingCreate) {
          await hook({ doc: docRecord, req })
        }
      }
    }

    if (operation === 'update') {
      const previousStatus = (previousDoc as Record<string, unknown>)?.status as
        | string
        | undefined
      const newStatus = docRecord.status as string | undefined

      if (previousStatus && newStatus && previousStatus !== newStatus) {
        if (hooks.afterStatusChange) {
          for (const hook of hooks.afterStatusChange) {
            await hook({ doc: docRecord, newStatus, previousStatus, req })
          }
        }
        if (newStatus === 'confirmed' && hooks.afterBookingConfirm) {
          for (const hook of hooks.afterBookingConfirm) {
            await hook({ doc: docRecord, req })
          }
        }
        if (newStatus === 'cancelled' && hooks.afterBookingCancel) {
          for (const hook of hooks.afterBookingCancel) {
            await hook({ doc: docRecord, req })
          }
        }
      }
    }

    return doc
  }
}

export function createReservationsCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
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
        defaultValue: 'pending',
        label: ({ t }) => (t as PluginT)('reservation:fieldStatus'),
        options: [
          { label: ({ t }) => (t as PluginT)('reservation:statusPending'), value: 'pending' },
          { label: ({ t }) => (t as PluginT)('reservation:statusConfirmed'), value: 'confirmed' },
          { label: ({ t }) => (t as PluginT)('reservation:statusCompleted'), value: 'completed' },
          { label: ({ t }) => (t as PluginT)('reservation:statusCancelled'), value: 'cancelled' },
          { label: ({ t }) => (t as PluginT)('reservation:statusNoShow'), value: 'no-show' },
        ],
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
    ],
    hooks: {
      afterChange: [createPluginHooksAfterChange(config.hooks)],
      beforeChange: [
        createPluginHooksBeforeChange(config.hooks),
        calculateEndTime(config),
        validateConflicts(config),
        validateStatusTransition(),
        validateCancellation(config),
      ],
    },
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
    },
  }
}

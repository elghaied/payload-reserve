import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  CollectionConfig,
  CollectionSlug,
} from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ReservationPluginHooks, ResolvedReservationPluginConfig } from '../types.js'

import { calculateEndTime } from '../hooks/reservations/calculateEndTime.js'
import { checkIdempotency } from '../hooks/reservations/checkIdempotency.js'
import { enforceCustomerOwnership } from '../hooks/reservations/enforceCustomerOwnership.js'
import { expandRequiredResources } from '../hooks/reservations/expandRequiredResources.js'
import { onStatusChange } from '../hooks/reservations/onStatusChange.js'
import { validateCancellation } from '../hooks/reservations/validateCancellation.js'
import { validateConflicts } from '../hooks/reservations/validateConflicts.js'
import { validateGuestBooking } from '../hooks/reservations/validateGuestBooking.js'
import { validateStatusTransition } from '../hooks/reservations/validateStatusTransition.js'
import { statusToI18nKey } from '../utilities/i18nUtils.js'
import { composeAccess, makeReservationOwnerAccess } from '../utilities/ownerAccess.js'

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
  return async ({ context, doc, operation, req }) => {
    if (context?.skipReservationHooks) {return doc}
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
  const rom = config.resourceOwnerMode
  const access =
    composeAccess(rom ? makeReservationOwnerAccess(rom) : {}, config.access.reservations)

  return {
    slug: config.slugs.reservations,
    access,
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
        relationTo: config.slugs.services as unknown as CollectionSlug,
        required: true,
      },
      {
        name: 'resource',
        type: 'relationship',
        label: ({ t }) => (t as PluginT)('reservation:fieldResource'),
        relationTo: config.slugs.resources as unknown as CollectionSlug,
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
        relationTo: config.slugs.customers as unknown as CollectionSlug,
        required: false,
      },
      {
        name: 'guest',
        type: 'group',
        admin: {
          description: ({ t }) => (t as PluginT)('reservation:fieldGuestDesc'),
        },
        fields: [
          {
            name: 'name',
            type: 'text',
            label: ({ t }) => (t as PluginT)('reservation:fieldGuestName'),
            maxLength: 200,
          },
          {
            name: 'email',
            type: 'email',
            label: ({ t }) => (t as PluginT)('reservation:fieldGuestEmail'),
          },
          {
            name: 'phone',
            type: 'text',
            label: ({ t }) => (t as PluginT)('reservation:fieldGuestPhone'),
            maxLength: 50,
          },
        ],
        label: ({ t }) => (t as PluginT)('reservation:fieldGuest'),
      },
      {
        name: 'cancellationToken',
        type: 'text',
        access: {
          // Server-generated secret: never settable via the API (the
          // validateGuestBooking hook stamps it), readable only by staff/admin.
          create: () => false,
          read: ({ req }) =>
            Boolean(req.user) && req.user!.collection !== config.slugs.customers,
          update: () => false,
        },
        admin: {
          hidden: true,
        },
        index: true,
      },
      {
        name: 'startTime',
        type: 'date',
        admin: {
          components: {
            Field: 'payload-reserve/client#AvailabilityTimeField',
          },
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
            const key = statusToI18nKey(s)
            const translated = (t as PluginT)(key)
            return translated !== key ? translated : s.charAt(0).toUpperCase() + s.slice(1)
          },
          value: s,
        })),
      },
      {
        name: 'cancellationReason',
        type: 'textarea',
        admin: {
          condition: (_, siblingData) => siblingData?.status === statusMachine.cancelStatus,
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
          description: ({ t }) => (t as PluginT)('reservation:fieldItemsDesc'),
        },
        fields: [
          {
            name: 'resource',
            type: 'relationship',
            label: ({ t }) => (t as PluginT)('reservation:fieldResource'),
            relationTo: config.slugs.resources as unknown as CollectionSlug,
            required: true,
          },
          {
            name: 'service',
            type: 'relationship',
            label: ({ t }) => (t as PluginT)('reservation:fieldService'),
            relationTo: config.slugs.services as unknown as CollectionSlug,
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
      ...config.extraReservationFields,
    ],
    hooks: {
      afterChange: [
        createPluginHooksAfterCreate(config.hooks),
        onStatusChange(config),
      ],
      beforeChange: [
        createPluginHooksBeforeCreate(config.hooks),
        enforceCustomerOwnership(config),
        checkIdempotency(config),
        validateGuestBooking(config),
        expandRequiredResources(config),
        calculateEndTime(config),
        validateConflicts(config),
        // validateCancellation runs BEFORE validateStatusTransition so a cancel
        // rejected by the notice period never fires the beforeBookingCancel
        // plugin hooks (e.g. refund initiation) for an update that won't land.
        validateCancellation(config),
        validateStatusTransition(config),
      ],
    },
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionReservations'),
    },
  }
}

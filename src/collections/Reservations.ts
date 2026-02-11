import type { CollectionConfig } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { calculateEndTime } from '../hooks/reservations/calculateEndTime.js'
import { validateCancellation } from '../hooks/reservations/validateCancellation.js'
import { validateConflicts } from '../hooks/reservations/validateConflicts.js'
import { validateStatusTransition } from '../hooks/reservations/validateStatusTransition.js'

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
            Component: 'reservation-plugin/client#CalendarView',
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
        relationTo: config.slugs.services,
        required: true,
      },
      {
        name: 'resource',
        type: 'relationship',
        relationTo: config.slugs.resources,
        required: true,
      },
      {
        name: 'customer',
        type: 'relationship',
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
      },
      {
        name: 'status',
        type: 'select',
        defaultValue: 'pending',
        options: [
          { label: 'Pending', value: 'pending' },
          { label: 'Confirmed', value: 'confirmed' },
          { label: 'Completed', value: 'completed' },
          { label: 'Cancelled', value: 'cancelled' },
          { label: 'No Show', value: 'no-show' },
        ],
      },
      {
        name: 'cancellationReason',
        type: 'textarea',
        admin: {
          condition: (_, siblingData) => siblingData?.status === 'cancelled',
        },
      },
      {
        name: 'notes',
        type: 'textarea',
      },
    ],
    hooks: {
      beforeChange: [
        calculateEndTime(config),
        validateConflicts(config),
        validateStatusTransition(),
        validateCancellation(config),
      ],
    },
  }
}

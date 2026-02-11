import type { CollectionConfig } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

export function createSchedulesCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  return {
    slug: config.slugs.schedules,
    access: config.access.schedules ?? {},
    admin: {
      group: config.adminGroup,
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        required: true,
      },
      {
        name: 'resource',
        type: 'relationship',
        relationTo: config.slugs.resources,
        required: true,
      },
      {
        name: 'scheduleType',
        type: 'select',
        defaultValue: 'recurring',
        options: [
          { label: 'Recurring', value: 'recurring' },
          { label: 'Manual', value: 'manual' },
        ],
      },
      {
        name: 'recurringSlots',
        type: 'array',
        admin: {
          condition: (_, siblingData) => siblingData?.scheduleType === 'recurring',
        },
        fields: [
          {
            name: 'day',
            type: 'select',
            options: [
              { label: 'Monday', value: 'mon' },
              { label: 'Tuesday', value: 'tue' },
              { label: 'Wednesday', value: 'wed' },
              { label: 'Thursday', value: 'thu' },
              { label: 'Friday', value: 'fri' },
              { label: 'Saturday', value: 'sat' },
              { label: 'Sunday', value: 'sun' },
            ],
            required: true,
          },
          {
            name: 'startTime',
            type: 'text',
            admin: {
              placeholder: '09:00',
            },
            label: 'Start Time (HH:mm)',
            required: true,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: 'End Time (HH:mm)',
            required: true,
          },
        ],
      },
      {
        name: 'manualSlots',
        type: 'array',
        admin: {
          condition: (_, siblingData) => siblingData?.scheduleType === 'manual',
        },
        fields: [
          {
            name: 'date',
            type: 'date',
            admin: {
              date: {
                pickerAppearance: 'dayOnly',
              },
            },
            required: true,
          },
          {
            name: 'startTime',
            type: 'text',
            admin: {
              placeholder: '09:00',
            },
            label: 'Start Time (HH:mm)',
            required: true,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: 'End Time (HH:mm)',
            required: true,
          },
        ],
      },
      {
        name: 'exceptions',
        type: 'array',
        fields: [
          {
            name: 'date',
            type: 'date',
            admin: {
              date: {
                pickerAppearance: 'dayOnly',
              },
            },
            required: true,
          },
          {
            name: 'reason',
            type: 'text',
          },
        ],
      },
      {
        name: 'active',
        type: 'checkbox',
        admin: {
          position: 'sidebar',
        },
        defaultValue: true,
      },
    ],
  }
}

import type { CollectionConfig } from 'payload'

import type { PluginT } from '../translations/index.js'
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
          {
            label: ({ t }) => (t as PluginT)('reservation:scheduleTypeRecurring'),
            value: 'recurring',
          },
          {
            label: ({ t }) => (t as PluginT)('reservation:scheduleTypeManual'),
            value: 'manual',
          },
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
              { label: ({ t }) => (t as PluginT)('reservation:dayMonday'), value: 'mon' },
              { label: ({ t }) => (t as PluginT)('reservation:dayTuesday'), value: 'tue' },
              { label: ({ t }) => (t as PluginT)('reservation:dayWednesday'), value: 'wed' },
              { label: ({ t }) => (t as PluginT)('reservation:dayThursday'), value: 'thu' },
              { label: ({ t }) => (t as PluginT)('reservation:dayFriday'), value: 'fri' },
              { label: ({ t }) => (t as PluginT)('reservation:daySaturday'), value: 'sat' },
              { label: ({ t }) => (t as PluginT)('reservation:daySunday'), value: 'sun' },
            ],
            required: true,
          },
          {
            name: 'startTime',
            type: 'text',
            admin: {
              placeholder: '09:00',
            },
            label: ({ t }) => (t as PluginT)('reservation:fieldStartTimeHHmm'),
            required: true,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndTimeHHmm'),
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
            label: ({ t }) => (t as PluginT)('reservation:fieldStartTimeHHmm'),
            required: true,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndTimeHHmm'),
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

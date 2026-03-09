import type { CollectionConfig, CollectionSlug } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { makeScheduleOwnerAccess } from '../utilities/ownerAccess.js'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

const validateTime = (value: null | string | undefined): string | true => {
  if (!value) return true // required handles emptiness
  return TIME_REGEX.test(value) || 'Invalid time format. Use HH:mm (e.g., 09:00, 17:30)'
}

export function createSchedulesCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  const rom = config.resourceOwnerMode
  const access =
    config.access.schedules ?? (rom ? makeScheduleOwnerAccess(rom) : {})

  return {
    slug: config.slugs.schedules,
    access,
    admin: {
      group: config.adminGroup,
      useAsTitle: 'name',
    },
    hooks: {
      beforeValidate: [
        ({ data }) => {
          const slots = (data?.recurringSlots as Array<{ endTime?: string; startTime?: string }>) ?? []
          for (const slot of slots) {
            if (slot.startTime && slot.endTime && slot.startTime >= slot.endTime) {
              throw new ValidationError({
                errors: [{ message: 'endTime must be after startTime', path: 'recurringSlots' }],
              })
            }
          }
          const manual = (data?.manualSlots as Array<{ endTime?: string; startTime?: string }>) ?? []
          for (const slot of manual) {
            if (slot.startTime && slot.endTime && slot.startTime >= slot.endTime) {
              throw new ValidationError({
                errors: [{ message: 'endTime must be after startTime', path: 'manualSlots' }],
              })
            }
          }
          return data
        },
      ],
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        label: ({ t }) => (t as PluginT)('reservation:fieldName'),
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
        name: 'scheduleType',
        type: 'select',
        defaultValue: 'recurring',
        label: ({ t }) => (t as PluginT)('reservation:fieldScheduleType'),
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
            label: ({ t }) => (t as PluginT)('reservation:fieldDay'),
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
            validate: validateTime,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndTimeHHmm'),
            required: true,
            validate: validateTime,
          },
        ],
        label: ({ t }) => (t as PluginT)('reservation:fieldRecurringSlots'),
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
            label: ({ t }) => (t as PluginT)('reservation:fieldDate'),
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
            validate: validateTime,
          },
          {
            name: 'endTime',
            type: 'text',
            admin: {
              placeholder: '17:00',
            },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndTimeHHmm'),
            required: true,
            validate: validateTime,
          },
        ],
        label: ({ t }) => (t as PluginT)('reservation:fieldManualSlots'),
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
            label: ({ t }) => (t as PluginT)('reservation:fieldDate'),
            required: true,
          },
          {
            name: 'reason',
            type: 'text',
            label: ({ t }) => (t as PluginT)('reservation:fieldReason'),
          },
        ],
        label: ({ t }) => (t as PluginT)('reservation:fieldExceptions'),
      },
      {
        name: 'active',
        type: 'checkbox',
        admin: {
          position: 'sidebar',
        },
        defaultValue: true,
        label: ({ t }) => (t as PluginT)('reservation:fieldActive'),
      },
    ],
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionSchedules'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionSchedules'),
    },
  }
}

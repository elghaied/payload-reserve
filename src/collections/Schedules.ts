import type { CollectionConfig, CollectionSlug } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../types.js'

import { composeAccess, makeScheduleOwnerAccess } from '../utilities/ownerAccess.js'
import { buildSelectOptions } from '../utilities/selectOptions.js'
import { getDayKeyInTimezone } from '../utilities/timezoneUtils.js'

const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const validateTime = (value: null | string | undefined): string | true => {
  if (!value) { return true } // required handles emptiness
  return TIME_REGEX.test(value) || 'Invalid time format. Use HH:mm (e.g., 09:00, 17:30)'
}

export function createSchedulesCollection(
  config: ResolvedReservationPluginConfig,
): CollectionConfig {
  const rom = config.resourceOwnerMode
  const access =
    composeAccess(rom ? makeScheduleOwnerAccess(rom) : {}, config.access.schedules)

  return {
    slug: config.slugs.schedules,
    access,
    admin: {
      group: config.adminGroup,
      useAsTitle: 'name',
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
            admin: { date: { pickerAppearance: 'dayOnly' } },
            label: ({ t }) => (t as PluginT)('reservation:fieldDate'),
            required: true,
          },
          {
            name: 'endDate',
            type: 'date',
            admin: { date: { pickerAppearance: 'dayOnly' } },
            label: ({ t }) => (t as PluginT)('reservation:fieldEndDate'),
          },
          {
            name: 'type',
            type: 'select',
            label: ({ t }) => (t as PluginT)('reservation:fieldLeaveType'),
            options: buildSelectOptions(config.leaveTypes),
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
    hooks: {
      beforeValidate: [
        ({ data }) => {
          // Only compare well-formed HH:mm values — otherwise a malformed time
          // ('9:00') would lexically compare wrong and surface this misleading
          // message instead of the field validator's format error.
          const HHMM = /^\d{2}:\d{2}$/
          const ordered = (start?: string, end?: string) =>
            !start || !end || !HHMM.test(start) || !HHMM.test(end) || start < end
          const slots = (data?.recurringSlots as Array<{ endTime?: string; startTime?: string }>) ?? []
          for (const slot of slots) {
            if (!ordered(slot.startTime, slot.endTime)) {
              throw new ValidationError({
                errors: [{ message: 'endTime must be after startTime', path: 'recurringSlots' }],
              })
            }
          }
          const manual = (data?.manualSlots as Array<{ endTime?: string; startTime?: string }>) ?? []
          for (const slot of manual) {
            if (!ordered(slot.startTime, slot.endTime)) {
              throw new ValidationError({
                errors: [{ message: 'endTime must be after startTime', path: 'manualSlots' }],
              })
            }
          }
          const exceptions = (data?.exceptions as Array<{ date?: string; endDate?: string }>) ?? []
          for (const exc of exceptions) {
            if (exc.date && exc.endDate) {
              const start = getDayKeyInTimezone(new Date(exc.date), config.timezone)
              const end = getDayKeyInTimezone(new Date(exc.endDate), config.timezone)
              if (end < start) {
                throw new ValidationError({
                  errors: [{ message: 'exception endDate must be on or after date', path: 'exceptions' }],
                })
              }
            }
          }
          return data
        },
      ],
    },
    labels: {
      plural: ({ t }) => (t as PluginT)('reservation:collectionSchedules'),
      singular: ({ t }) => (t as PluginT)('reservation:collectionSchedules'),
    },
  }
}

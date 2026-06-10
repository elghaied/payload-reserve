import type { DayOfWeek } from '../types.js'

import {
  combineDayKeyAndTime,
  getDayKeyInTimezone,
  getDayOfWeekFromDayKey,
} from './timezoneUtils.js'

const DAY_MAP: Record<DayOfWeek, number> = {
  fri: 5,
  mon: 1,
  sat: 6,
  sun: 0,
  thu: 4,
  tue: 2,
  wed: 3,
}

/**
 * @deprecated Server-TZ-dependent legacy helper — no longer used by the plugin's
 * own resolution path. Use timezoneUtils (getDayOfWeekFromDayKey / combineDayKeyAndTime).
 */
export function getDayOfWeek(date: Date): DayOfWeek {
  const jsDay = date.getDay()
  const entries = Object.entries(DAY_MAP) as [DayOfWeek, number][]
  const found = entries.find(([, num]) => num === jsDay)
  return found ? found[0] : 'mon'
}

/**
 * @deprecated Server-TZ-dependent legacy helper — no longer used by the plugin's
 * own resolution path. Use timezoneUtils (getDayOfWeekFromDayKey / combineDayKeyAndTime).
 */
export function dateMatchesDay(date: Date, day: DayOfWeek): boolean {
  return date.getDay() === DAY_MAP[day]
}

/**
 * Parse a HH:mm time string to hours and minutes.
 */
export function parseTime(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number)
  return { hours: h, minutes: m }
}

/**
 * @deprecated Server-TZ-dependent legacy helper — no longer used by the plugin's
 * own resolution path. Use timezoneUtils (getDayOfWeekFromDayKey / combineDayKeyAndTime).
 */
export function combineDateAndTime(date: Date, time: string): Date {
  const { hours, minutes } = parseTime(time)
  const combined = new Date(date)
  combined.setHours(hours, minutes, 0, 0)
  return combined
}

/**
 * Check if a calendar day is an exception day in the schedule.
 * Supports range exceptions via optional endDate (inclusive on both ends).
 * `date` may be a Date instant (keyed in `timeZone`) or a YYYY-MM-DD day key.
 */
export function isExceptionDate(
  date: Date | string,
  exceptions: Array<{ date: string; endDate?: string }>,
  timeZone: string = 'UTC',
): boolean {
  const target = typeof date === 'string' ? date : getDayKeyInTimezone(date, timeZone)
  return exceptions.some((exc) => {
    const start = getDayKeyInTimezone(new Date(exc.date), timeZone)
    const end = exc.endDate ? getDayKeyInTimezone(new Date(exc.endDate), timeZone) : start
    return target >= start && target <= end
  })
}

type RecurringSlot = {
  day: DayOfWeek
  endTime: string
  startTime: string
}

type ManualSlot = {
  date: string
  endTime: string
  startTime: string
}

type Schedule = {
  active?: boolean
  exceptions?: Array<{ date: string; endDate?: string }>
  manualSlots?: ManualSlot[]
  recurringSlots?: RecurringSlot[]
  scheduleType: 'manual' | 'recurring'
}

type TimeRange = {
  end: Date
  start: Date
}

/**
 * Resolve a schedule to concrete available time ranges for a calendar day.
 * `date` may be a Date instant (keyed in `timeZone`) or a YYYY-MM-DD day key.
 * All wall-clock times (HH:mm) are interpreted in `timeZone`.
 */
export function resolveScheduleForDate(
  schedule: Schedule,
  date: Date | string,
  timeZone: string = 'UTC',
): TimeRange[] {
  if (schedule.active === false) {return []}

  const dayKey = typeof date === 'string' ? date : getDayKeyInTimezone(date, timeZone)

  const exceptions = schedule.exceptions ?? []
  if (isExceptionDate(dayKey, exceptions, timeZone)) {return []}

  const ranges: TimeRange[] = []

  if (schedule.scheduleType === 'recurring') {
    const slots = schedule.recurringSlots ?? []
    const dayOfWeek = getDayOfWeekFromDayKey(dayKey)
    for (const slot of slots) {
      if (slot.day === dayOfWeek) {
        ranges.push({
          end: combineDayKeyAndTime(dayKey, slot.endTime, timeZone),
          start: combineDayKeyAndTime(dayKey, slot.startTime, timeZone),
        })
      }
    }
  } else if (schedule.scheduleType === 'manual') {
    const slots = schedule.manualSlots ?? []
    for (const slot of slots) {
      const slotDayKey = getDayKeyInTimezone(new Date(slot.date), timeZone)
      if (slotDayKey === dayKey) {
        ranges.push({
          end: combineDayKeyAndTime(dayKey, slot.endTime, timeZone),
          start: combineDayKeyAndTime(dayKey, slot.startTime, timeZone),
        })
      }
    }
  }

  return ranges
}

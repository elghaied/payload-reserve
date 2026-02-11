import type { DayOfWeek } from '../types.js'

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
 * Get the DayOfWeek value for a given Date.
 */
export function getDayOfWeek(date: Date): DayOfWeek {
  const jsDay = date.getDay()
  const entries = Object.entries(DAY_MAP) as [DayOfWeek, number][]
  const found = entries.find(([, num]) => num === jsDay)
  return found ? found[0] : 'mon'
}

/**
 * Check if a date string (ISO) matches a DayOfWeek.
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
 * Combine a date (day) with a HH:mm time string into a full Date.
 */
export function combineDateAndTime(date: Date, time: string): Date {
  const { hours, minutes } = parseTime(time)
  const combined = new Date(date)
  combined.setHours(hours, minutes, 0, 0)
  return combined
}

/**
 * Check if a given date is an exception date in the schedule.
 */
export function isExceptionDate(
  date: Date,
  exceptions: Array<{ date: string }>,
): boolean {
  const dateStr = date.toISOString().split('T')[0]
  return exceptions.some((exc) => {
    const excDateStr = new Date(exc.date).toISOString().split('T')[0]
    return excDateStr === dateStr
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
  exceptions?: Array<{ date: string }>
  manualSlots?: ManualSlot[]
  recurringSlots?: RecurringSlot[]
  scheduleType: 'manual' | 'recurring'
}

type TimeRange = {
  end: Date
  start: Date
}

/**
 * Resolve a schedule to concrete available time ranges for a given date.
 */
export function resolveScheduleForDate(schedule: Schedule, date: Date): TimeRange[] {
  if (schedule.active === false) {return []}

  const exceptions = schedule.exceptions ?? []
  if (isExceptionDate(date, exceptions)) {return []}

  const ranges: TimeRange[] = []

  if (schedule.scheduleType === 'recurring') {
    const slots = schedule.recurringSlots ?? []
    const dayOfWeek = getDayOfWeek(date)
    for (const slot of slots) {
      if (slot.day === dayOfWeek) {
        ranges.push({
          end: combineDateAndTime(date, slot.endTime),
          start: combineDateAndTime(date, slot.startTime),
        })
      }
    }
  } else if (schedule.scheduleType === 'manual') {
    const slots = schedule.manualSlots ?? []
    const dateStr = date.toISOString().split('T')[0]
    for (const slot of slots) {
      const slotDateStr = new Date(slot.date).toISOString().split('T')[0]
      if (slotDateStr === dateStr) {
        ranges.push({
          end: combineDateAndTime(date, slot.endTime),
          start: combineDateAndTime(date, slot.startTime),
        })
      }
    }
  }

  return ranges
}

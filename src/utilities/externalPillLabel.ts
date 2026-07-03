import { getDayKeyInTimezone } from './timezoneUtils.js'

/**
 * Compact month-cell label for an external busy interval on a given day:
 * - interval covers the whole day (or spans past it) → just the label
 * - otherwise → "HH:MM label" using the interval's start in the given timezone
 */
export function externalPillLabel(
  ev: { end: string; label?: string; start: string },
  dayKey: string,
  timeZone: string,
  fallbackLabel: string,
): string {
  const label = ev.label ?? fallbackLabel
  const startKey = getDayKeyInTimezone(new Date(ev.start), timeZone)
  const endKey = getDayKeyInTimezone(new Date(new Date(ev.end).getTime() - 1), timeZone)
  const coversWholeDay = startKey < dayKey || (startKey === dayKey && endKey > dayKey)
  if (coversWholeDay) {
    return label
  }
  const time = new Date(ev.start).toLocaleTimeString([], {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone,
  })
  return `${time} ${label}`
}

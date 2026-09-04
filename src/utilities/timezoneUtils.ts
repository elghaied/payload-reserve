import type { DayOfWeek } from '../types.js'

const DAY_BY_UTC_INDEX: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * Day key (`YYYY-MM-DD`) of a date-only field — `Schedule.exceptions[].date` /
 * `endDate` and `manualSlots[].date`.
 *
 * These fields name a calendar day, not an instant, but Payload stores a `date`
 * field as an instant. Every writer encodes the intended day in the instant's
 * UTC calendar date: the admin `dayOnly` picker stores noon UTC (`@payloadcms/ui`'s
 * DatePicker sets `12 - tzOffset` hours precisely so the UTC date survives the
 * browser's zone), and an API/seed-written bare `'2025-12-25'` — the form the
 * README shows — parses to midnight UTC. So the day is the UTC calendar date of
 * the stored value, and it must NOT be re-keyed in the business timezone: doing
 * that turned `'2025-12-25'` into December 24 for every zone west of UTC (and
 * the picker's noon UTC into the 26th at UTC+13). A bare day key is returned
 * as-is. An unparseable value yields `''`, which matches no day.
 */
export function dateFieldToDayKey(value: Date | string): string {
  if (typeof value === 'string' && DAY_KEY_RE.test(value)) {return value}
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {return ''}
  return d.toISOString().slice(0, 10)
}

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>()
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

function getDayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayKeyFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
    dayKeyFormatters.set(timeZone, formatter)
  }
  return formatter
}

function getWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallClockFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    })
    wallClockFormatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Wall-clock hour (0-23) of an instant as seen in the given timezone.
 */
export function getHourInTimezone(date: Date, timeZone: string): number {
  const parts = getWallClockFormatter(timeZone).formatToParts(date)
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
}

/**
 * True when the string is a real calendar date in YYYY-MM-DD form
 * (round-trip check rejects shape-valid impossibilities like 2026-02-30).
 */
export function isValidDayKey(dayKey: string): boolean {
  if (!DAY_KEY_RE.test(dayKey)) {
    return false
  }
  try {
    return new Date(`${dayKey}T00:00:00Z`).toISOString().slice(0, 10) === dayKey
  } catch {
    return false
  }
}

/**
 * True when the given string is a usable IANA timezone name. Non-throwing
 * counterpart to {@link validateTimezone}; an empty/nullish value is not valid.
 */
export function isValidTimezone(timeZone: null | string | undefined): timeZone is string {
  if (!timeZone) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Throws when the given string is not a valid IANA timezone name.
 */
export function validateTimezone(timeZone: string): void {
  if (!isValidTimezone(timeZone)) {
    throw new Error(
      `Invalid timezone "${timeZone}" — use an IANA name like 'Europe/Paris' or 'UTC'`,
    )
  }
}

/**
 * Calendar day key (YYYY-MM-DD) of an instant as seen in the given timezone.
 * en-CA locale formats dates as YYYY-MM-DD natively.
 */
export function getDayKeyInTimezone(date: Date, timeZone: string): string {
  return getDayKeyFormatter(timeZone).format(date)
}

/**
 * Day of week for a calendar date — TZ-independent pure calendar math.
 */
export function getDayOfWeekFromDayKey(dayKey: string): DayOfWeek {
  if (!DAY_KEY_RE.test(dayKey)) {
    throw new Error(`Invalid day key "${dayKey}" — expected YYYY-MM-DD`)
  }
  return DAY_BY_UTC_INDEX[new Date(`${dayKey}T00:00:00Z`).getUTCDay()]
}

/**
 * Wall-clock parts of a UTC instant in the given timezone, reconstructed as a
 * UTC timestamp — the difference to the instant is the zone's offset.
 */
function offsetMs(timeZone: string, utcDate: Date): number {
  const parts = getWallClockFormatter(timeZone).formatToParts(utcDate)
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUTC - utcDate.getTime()
}

/**
 * The UTC instant of wall-clock `HH:mm` on calendar day `dayKey` in `timeZone`.
 * Two-pass offset algorithm; DST-safe. Spring-forward gap times resolve to a
 * nearby valid instant (for midnight-gap zones like America/Santiago this can be
 * late on the prior calendar day); fall-back ambiguous times resolve to one
 * consistent occurrence.
 */
export function combineDayKeyAndTime(dayKey: string, time: string, timeZone: string): Date {
  if (!DAY_KEY_RE.test(dayKey)) {
    throw new Error(`Invalid day key "${dayKey}" — expected YYYY-MM-DD`)
  }
  if (!TIME_RE.test(time)) {
    throw new Error(`Invalid time "${time}" — expected HH:mm`)
  }
  const [y, mo, d] = dayKey.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const candidate = guess - offsetMs(timeZone, new Date(guess))
  return new Date(guess - offsetMs(timeZone, new Date(candidate)))
}

/**
 * Instant of 23:59:59.999 (in `timeZone`) on the day containing `date`.
 */
export function endOfDayInTimezone(date: Date, timeZone: string): Date {
  const dayKey = getDayKeyInTimezone(date, timeZone)
  const lastMinute = combineDayKeyAndTime(dayKey, '23:59', timeZone)
  return new Date(lastMinute.getTime() + 59_999)
}

/**
 * Pure calendar arithmetic on day keys — DST-proof day iteration.
 */
export function addDaysToDayKey(dayKey: string, days: number): string {
  if (!DAY_KEY_RE.test(dayKey)) {
    throw new Error(`Invalid day key "${dayKey}" — expected YYYY-MM-DD`)
  }
  const base = new Date(`${dayKey}T00:00:00Z`)
  const shifted = new Date(base.getTime() + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

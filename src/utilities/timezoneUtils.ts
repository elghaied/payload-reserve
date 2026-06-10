import type { DayOfWeek } from '../types.js'

const DAY_BY_UTC_INDEX: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Throws when the given string is not a valid IANA timezone name.
 */
export function validateTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
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
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(date)
}

/**
 * Day of week for a calendar date — TZ-independent pure calendar math.
 */
export function getDayOfWeekFromDayKey(dayKey: string): DayOfWeek {
  return DAY_BY_UTC_INDEX[new Date(`${dayKey}T00:00:00Z`).getUTCDay()]
}

/**
 * Wall-clock parts of a UTC instant in the given timezone, reconstructed as a
 * UTC timestamp — the difference to the instant is the zone's offset.
 */
function offsetMs(timeZone: string, utcDate: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(utcDate)
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
 * Two-pass offset algorithm; DST-safe. Spring-forward gap times resolve to the
 * post-transition instant; fall-back ambiguous times resolve to one consistent
 * occurrence.
 */
export function combineDayKeyAndTime(dayKey: string, time: string, timeZone: string): Date {
  if (!DAY_KEY_RE.test(dayKey)) {
    throw new Error(`Invalid day key "${dayKey}" — expected YYYY-MM-DD`)
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
  const base = new Date(`${dayKey}T00:00:00Z`)
  const shifted = new Date(base.getTime() + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

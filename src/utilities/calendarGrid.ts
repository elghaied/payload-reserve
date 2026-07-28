import { addDaysToDayKey, combineDayKeyAndTime } from './timezoneUtils.js'

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDayKey(dayKey: string): void {
  if (!DAY_KEY_RE.test(dayKey)) {
    throw new Error(`Invalid day key "${dayKey}" — expected YYYY-MM-DD`)
  }
}

/**
 * Weekday index for a calendar date, 0 = Sunday. TZ-independent pure calendar
 * math — the UTC instant is a carrier for the date only, never a real time.
 */
export function weekdayIndexOfDayKey(dayKey: string): number {
  assertDayKey(dayKey)
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay()
}

/** The Sunday on or before `dayKey`. */
export function startOfWeekDayKey(dayKey: string): string {
  return addDaysToDayKey(dayKey, -weekdayIndexOfDayKey(dayKey))
}

/** The Sunday on or before the 1st of `dayKey`'s month — the month grid origin. */
export function monthGridStartDayKey(dayKey: string): string {
  assertDayKey(dayKey)
  return startOfWeekDayKey(`${dayKey.slice(0, 8)}01`)
}

/** `count` consecutive day keys starting at `startDayKey`. */
export function dayKeySequence(startDayKey: string, count: number): string[] {
  assertDayKey(startDayKey)
  const keys: string[] = []
  for (let i = 0; i < count; i++) {
    keys.push(addDaysToDayKey(startDayKey, i))
  }
  return keys
}

/**
 * The instant at `hour`:00 on `dayKey` in the BUSINESS timezone.
 *
 * This is the whole point of the module: calendar rows are labelled with
 * getHourInTimezone(date, businessTZ), so the instant a row maps to must be
 * built in that same zone. Using Date#setHours here builds it in the VIEWER's
 * zone, which is how clicking "10:00" came to book a different hour.
 */
export function instantAtHour(dayKey: string, hour: number, timeZone: string): Date {
  return combineDayKeyAndTime(dayKey, `${String(hour).padStart(2, '0')}:00`, timeZone)
}

/**
 * Like `instantAtHour`, but tolerates the exclusive end hour a grid window can
 * carry: hour 24 is not a wall-clock time (`combineDayKeyAndTime` rejects
 * "24:00"), it means midnight starting the FOLLOWING day, so carry it onto the
 * next day key.
 *
 * The carry is deliberately a day-key increment rather than `+24h` on the day's
 * start: on a DST-transition day the grid spans 23 or 25 real hours, and only
 * re-resolving midnight in the business zone lands on the right instant.
 */
export function gridInstant(dayKey: string, hour: number, timeZone: string): Date {
  return instantAtHour(addDaysToDayKey(dayKey, Math.floor(hour / 24)), hour % 24, timeZone)
}

/**
 * A Date safe to hand to Intl for rendering `dayKey`'s calendar date.
 *
 * Noon is deliberate: far enough from both midnights that formatting it back
 * with the SAME `timeZone` it was built with can never render the adjacent
 * date, DST included — which is how every caller in this codebase uses it
 * (construct and format in the one business zone). The margin is only ±12h
 * from that zone's own offset, not unconditional: formatting in a *different*
 * zone whose offset differs from `timeZone`'s by more than ~12h (e.g. noon
 * built in Pacific/Auckland, UTC+12/+13, formatted in a UTC-11 zone) can still
 * land on the adjacent day.
 */
export function displayDateForDayKey(dayKey: string, timeZone: string): Date {
  return combineDayKeyAndTime(dayKey, '12:00', timeZone)
}

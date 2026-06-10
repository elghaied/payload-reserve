import { describe, expect, it } from 'vitest'

import {
  addDaysToDayKey,
  combineDayKeyAndTime,
  endOfDayInTimezone,
  getDayKeyInTimezone,
  getDayOfWeekFromDayKey,
  validateTimezone,
} from '../src/utilities/timezoneUtils.js'

describe('validateTimezone', () => {
  it('accepts valid IANA names', () => {
    expect(() => validateTimezone('UTC')).not.toThrow()
    expect(() => validateTimezone('Europe/Paris')).not.toThrow()
    expect(() => validateTimezone('America/New_York')).not.toThrow()
  })

  it('rejects invalid names with a helpful message', () => {
    expect(() => validateTimezone('Mars/Olympus')).toThrow(/Invalid timezone "Mars\/Olympus"/)
    expect(() => validateTimezone('')).toThrow(/Invalid timezone/)
  })
})

describe('getDayKeyInTimezone', () => {
  // 2026-06-10T23:30:00Z — still June 10 in UTC, already June 11 in UTC+14,
  // and June 10 evening in New York.
  const instant = new Date('2026-06-10T23:30:00.000Z')

  it('returns the UTC day for UTC', () => {
    expect(getDayKeyInTimezone(instant, 'UTC')).toBe('2026-06-10')
  })

  it('shifts forward across the dateline (Pacific/Kiritimati, UTC+14)', () => {
    expect(getDayKeyInTimezone(instant, 'Pacific/Kiritimati')).toBe('2026-06-11')
  })

  it('stays on the same day for America/New_York (UTC-4 in June)', () => {
    expect(getDayKeyInTimezone(instant, 'America/New_York')).toBe('2026-06-10')
  })

  it('shifts backward near UTC midnight for western zones', () => {
    // 2026-06-10T02:00:00Z is still June 9, 22:00 in New York
    expect(getDayKeyInTimezone(new Date('2026-06-10T02:00:00.000Z'), 'America/New_York')).toBe(
      '2026-06-09',
    )
  })
})

describe('getDayOfWeekFromDayKey', () => {
  it('maps known dates (TZ-independent calendar math)', () => {
    expect(getDayOfWeekFromDayKey('2026-06-10')).toBe('wed')
    expect(getDayOfWeekFromDayKey('2026-06-14')).toBe('sun')
    expect(getDayOfWeekFromDayKey('2026-01-01')).toBe('thu')
  })
})

describe('combineDayKeyAndTime', () => {
  it('interprets HH:mm as UTC wall-clock for UTC', () => {
    expect(combineDayKeyAndTime('2026-06-10', '09:00', 'UTC').toISOString()).toBe(
      '2026-06-10T09:00:00.000Z',
    )
  })

  it('interprets HH:mm as Paris wall-clock (summer, UTC+2)', () => {
    expect(combineDayKeyAndTime('2026-06-10', '09:00', 'Europe/Paris').toISOString()).toBe(
      '2026-06-10T07:00:00.000Z',
    )
  })

  it('interprets HH:mm as Paris wall-clock (winter, UTC+1)', () => {
    expect(combineDayKeyAndTime('2026-01-10', '09:00', 'Europe/Paris').toISOString()).toBe(
      '2026-01-10T08:00:00.000Z',
    )
  })

  it('resolves inside the spring-forward gap without error (Paris 2026-03-29 02:30)', () => {
    // 02:00-03:00 local does not exist that night; accept the post-transition instant.
    const result = combineDayKeyAndTime('2026-03-29', '02:30', 'Europe/Paris')
    expect(Number.isNaN(result.getTime())).toBe(false)
    // Must land within the surrounding hour either side of the gap
    expect(result.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-03-29T00:30:00.000Z').getTime(),
    )
    expect(result.getTime()).toBeLessThanOrEqual(new Date('2026-03-29T01:30:00.000Z').getTime())
  })

  it('resolves fall-back ambiguous times consistently (New York 2026-11-01 01:30)', () => {
    const result = combineDayKeyAndTime('2026-11-01', '01:30', 'America/New_York')
    expect(Number.isNaN(result.getTime())).toBe(false)
    // 01:30 EDT = 05:30Z; 01:30 EST = 06:30Z — either is acceptable, but it must be one of them
    const ms = result.getTime()
    const edt = new Date('2026-11-01T05:30:00.000Z').getTime()
    const est = new Date('2026-11-01T06:30:00.000Z').getTime()
    expect([edt, est]).toContain(ms)
  })
})

describe('endOfDayInTimezone', () => {
  it('ends the Paris day containing the instant', () => {
    // 23:00Z June 10 is already June 11, 01:00 in Paris (summer)
    const result = endOfDayInTimezone(new Date('2026-06-10T23:00:00.000Z'), 'Europe/Paris')
    expect(result.toISOString()).toBe('2026-06-11T21:59:59.999Z')
  })

  it('ends the UTC day for UTC', () => {
    const result = endOfDayInTimezone(new Date('2026-06-10T10:00:00.000Z'), 'UTC')
    expect(result.toISOString()).toBe('2026-06-10T23:59:59.999Z')
  })
})

describe('addDaysToDayKey', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysToDayKey('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDaysToDayKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDayKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('is unaffected by DST (pure calendar arithmetic)', () => {
    expect(addDaysToDayKey('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDaysToDayKey('2026-03-29', 1)).toBe('2026-03-30')
  })
})

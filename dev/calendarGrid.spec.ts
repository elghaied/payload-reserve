import { describe, expect, it } from 'vitest'

import {
  dayKeySequence,
  displayDateForDayKey,
  instantAtHour,
  monthGridStartDayKey,
  startOfWeekDayKey,
  weekdayIndexOfDayKey,
} from '../src/utilities/calendarGrid.js'

const LA = 'America/Los_Angeles'
const AKL = 'Pacific/Auckland'

describe('calendarGrid — pure day-key math', () => {
  it('reports the weekday index of a day key', () => {
    expect(weekdayIndexOfDayKey('2026-09-01')).toBe(2) // Tuesday
    expect(weekdayIndexOfDayKey('2026-09-06')).toBe(0) // Sunday
  })

  it('snaps to the Sunday on or before a day key', () => {
    expect(startOfWeekDayKey('2026-09-01')).toBe('2026-08-30')
    expect(startOfWeekDayKey('2026-09-06')).toBe('2026-09-06')
  })

  it('finds the month grid start (Sunday on or before the 1st)', () => {
    expect(monthGridStartDayKey('2026-09-17')).toBe('2026-08-30')
    expect(monthGridStartDayKey('2026-02-14')).toBe('2026-02-01')
  })

  it('builds a contiguous day-key sequence across a month boundary', () => {
    const seq = dayKeySequence('2026-08-30', 4)
    expect(seq).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  })

  it('builds a 42-cell month grid', () => {
    const seq = dayKeySequence(monthGridStartDayKey('2026-09-17'), 42)
    expect(seq).toHaveLength(42)
    expect(seq[0]).toBe('2026-08-30')
    expect(seq[41]).toBe('2026-10-10')
  })
})

describe('calendarGrid — instants are built in the BUSINESS zone', () => {
  it('resolves 10:00 in Los Angeles regardless of the runner zone', () => {
    const instant = instantAtHour('2026-09-01', 10, LA)
    // 2026-09-01 is PDT (UTC-7), so 10:00 local is 17:00Z.
    expect(instant.toISOString()).toBe('2026-09-01T17:00:00.000Z')
  })

  it('resolves 10:00 in Auckland regardless of the runner zone', () => {
    const instant = instantAtHour('2026-09-01', 10, AKL)
    // 2026-09-01 is NZST (UTC+12), so 10:00 local is 22:00Z on Aug 31.
    expect(instant.toISOString()).toBe('2026-08-31T22:00:00.000Z')
  })

  it('produces DIFFERENT instants for the same day key in opposing zones', () => {
    expect(instantAtHour('2026-09-01', 10, LA).getTime()).not.toBe(
      instantAtHour('2026-09-01', 10, AKL).getTime(),
    )
  })

  it('round-trips a display date back to its own day key in both zones', () => {
    for (const zone of [LA, AKL]) {
      for (const key of ['2026-01-01', '2026-06-15', '2026-11-01']) {
        const shown = displayDateForDayKey(key, zone)
        const formatted = new Intl.DateTimeFormat('en-CA', {
          day: '2-digit',
          month: '2-digit',
          timeZone: zone,
          year: 'numeric',
        }).format(shown)
        expect(formatted).toBe(key)
      }
    }
  })

  it('handles a spring-forward day without drifting', () => {
    // US DST begins 2026-03-08. 02:00 does not exist locally.
    const before = instantAtHour('2026-03-08', 1, LA)
    const after = instantAtHour('2026-03-08', 3, LA)
    expect(after.getTime() - before.getTime()).toBe(3600_000)
  })
})

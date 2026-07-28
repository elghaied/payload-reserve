import { describe, expect, it } from 'vitest'

import {
  dayKeySequence,
  displayDateForDayKey,
  gridInstant,
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

  it('renders as noon, not midnight, in the business zone', () => {
    // The date-only round-trip above can't tell noon from midnight apart —
    // both land on the same calendar day. Pin the wall-clock hour directly;
    // 2026-11-01 is the US fall-back date, so this also can't be faked with
    // an elapsed-milliseconds check (midnight->noon is 13h in LA that day).
    for (const zone of [LA, AKL]) {
      for (const key of ['2026-01-01', '2026-06-15', '2026-11-01']) {
        const hour = new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          hourCycle: 'h23',
          timeZone: zone,
        }).format(displayDateForDayKey(key, zone))
        expect(hour).toBe('12')
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

describe('calendarGrid — gridInstant carries the exclusive end hour 24', () => {
  it('rejects hour 24 via instantAtHour, which is why gridInstant exists', () => {
    // computeHourWindow caps its end hour at 24, and the calendar grids feed it
    // straight in as the day's exclusive end. "24:00" is not a wall-clock time,
    // so the plain helper throws — a blank admin calendar for anyone with a
    // booking at or after 23:00.
    expect(() => instantAtHour('2026-04-05', 24, AKL)).toThrow(/24:00/)
    expect(() => gridInstant('2026-04-05', 24, AKL)).not.toThrow()
  })

  it('agrees with instantAtHour for every in-range hour', () => {
    for (const zone of [LA, AKL]) {
      for (let hour = 0; hour < 24; hour++) {
        expect(gridInstant('2026-09-01', hour, zone).toISOString()).toBe(
          instantAtHour('2026-09-01', hour, zone).toISOString(),
        )
      }
    }
  })

  it('resolves hour 24 to midnight starting the FOLLOWING day', () => {
    expect(gridInstant('2026-09-01', 24, AKL).toISOString()).toBe(
      instantAtHour('2026-09-02', 0, AKL).toISOString(),
    )
  })

  it('carries by day key, not by +24h, across a 25-hour fall-back day', () => {
    // NZ DST ends 2026-04-05, so that local day is 25 hours long.
    const dayStart = gridInstant('2026-04-05', 0, AKL)
    const dayEnd = gridInstant('2026-04-05', 24, AKL)

    expect(dayStart.toISOString()).toBe('2026-04-04T11:00:00.000Z') // 00:00 NZDT (+13)
    expect(dayEnd.toISOString()).toBe('2026-04-05T12:00:00.000Z') // 00:00 NZST (+12) next day
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(25 * 3600_000)

    // Discriminator: a naive `dayStart + 24h` lands an hour short, at 23:00
    // local on the same day, and would silently drop the grid's last hour row.
    const naive = new Date(dayStart.getTime() + 24 * 3600_000)
    expect(naive.toISOString()).toBe('2026-04-05T11:00:00.000Z')
    expect(dayEnd.toISOString()).not.toBe(naive.toISOString())
  })

  it('carries by day key, not by +24h, across a 23-hour spring-forward day', () => {
    // NZ DST begins 2026-09-27, so that local day is 23 hours long — the error
    // runs the other way, so this can't be faked with a fixed +1h fudge.
    const dayStart = gridInstant('2026-09-27', 0, AKL)
    const dayEnd = gridInstant('2026-09-27', 24, AKL)

    expect(dayStart.toISOString()).toBe('2026-09-26T12:00:00.000Z') // 00:00 NZST (+12)
    expect(dayEnd.toISOString()).toBe('2026-09-27T11:00:00.000Z') // 00:00 NZDT (+13) next day
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(23 * 3600_000)

    const naive = new Date(dayStart.getTime() + 24 * 3600_000)
    expect(naive.toISOString()).toBe('2026-09-27T12:00:00.000Z')
    expect(dayEnd.toISOString()).not.toBe(naive.toISOString())
  })
})

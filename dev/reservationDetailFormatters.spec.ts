import { describe, expect, it } from 'vitest'

import {
  formatCustomerName,
  formatReservationDateLabel,
  formatReservationTime,
  formatResourceNames,
} from '../src/components/ReservationDetail/formatters.js'

describe('formatCustomerName', () => {
  it('prefers a populated customer name', () => {
    expect(
      formatCustomerName(
        { id: '1', customer: { name: 'Jane Doe' }, startTime: '', status: '' },
        '?',
      ),
    ).toBe('Jane Doe')
  })

  it('joins first and last name when there is no name field', () => {
    expect(
      formatCustomerName(
        { id: '1', customer: { firstName: 'Jane', lastName: 'Doe' }, startTime: '', status: '' },
        '?',
      ),
    ).toBe('Jane Doe')
  })

  it('uses the guest name for a guest booking', () => {
    expect(
      formatCustomerName({ id: '1', guest: { name: 'Walk In' }, startTime: '', status: '' }, '?'),
    ).toBe('Walk In')
  })

  it('falls back to the guest email when the guest has no name', () => {
    expect(
      formatCustomerName({ id: '1', guest: { email: 'a@b.com' }, startTime: '', status: '' }, '?'),
    ).toBe('a@b.com')
  })

  it('returns the fallback for an unpopulated relationship id', () => {
    expect(
      formatCustomerName({ id: '1', customer: 'abc123', startTime: '', status: '' }, '?'),
    ).toBe('?')
  })
})

describe('formatResourceNames', () => {
  it('returns the top-level resource name', () => {
    expect(
      formatResourceNames({
        id: '1',
        resource: { id: 'r1', name: 'Alice' },
        startTime: '',
        status: '',
      }),
    ).toEqual(['Alice'])
  })

  it('includes item resources without duplicating the top-level one', () => {
    expect(
      formatResourceNames({
        id: '1',
        items: [{ resource: { id: 'r1', name: 'Alice' } }, { resource: { id: 'r2', name: 'Bob' } }],
        resource: { id: 'r1', name: 'Alice' },
        startTime: '',
        status: '',
      }),
    ).toEqual(['Alice', 'Bob'])
  })

  it('returns an empty array when nothing is populated', () => {
    expect(formatResourceNames({ id: '1', startTime: '', status: '' })).toEqual([])
  })
})

describe('formatReservationTime', () => {
  it('formats an ISO instant as HH:mm in the given timezone', () => {
    expect(formatReservationTime('2026-01-01T10:00:00.000Z', 'UTC')).toBe('10:00 AM')
  })

  it('respects a timezone override, not just UTC', () => {
    // 10:00 UTC is 05:00 in America/New_York (EST, UTC-5, in January).
    expect(formatReservationTime('2026-01-01T10:00:00.000Z', 'America/New_York')).toBe('05:00 AM')
  })

  it('returns the placeholder for an undefined input rather than throwing or "Invalid Date"', () => {
    expect(formatReservationTime(undefined, 'UTC')).toBe('—')
  })

  it('returns the placeholder for an empty-string input', () => {
    expect(formatReservationTime('', 'UTC')).toBe('—')
  })
})

describe('formatReservationDateLabel', () => {
  it('formats an ISO instant as a short weekday/day/month label', () => {
    // 2026-01-01 is a Thursday.
    expect(formatReservationDateLabel('2026-01-01T10:00:00.000Z', 'UTC')).toBe('Thu, Jan 1')
  })

  it('respects a timezone override that shifts the calendar day', () => {
    // 2026-01-01T02:00:00Z is still 2025-12-31 in America/Los_Angeles (PST, UTC-8).
    expect(formatReservationDateLabel('2026-01-01T02:00:00.000Z', 'America/Los_Angeles')).toBe(
      'Wed, Dec 31',
    )
  })
})

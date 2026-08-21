import { describe, expect, it } from 'vitest'

import {
  formatCustomerName,
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

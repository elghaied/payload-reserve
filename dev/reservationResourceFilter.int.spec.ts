import { describe, expect, it } from 'vitest'

import { reservationMatchesResource, sameId } from '../src/utilities/reservationResourceFilter.js'

// Regression for the Postgres id-type mismatch: reservations arrive over REST
// with NUMERIC ids while the filter/auto-select value is a string. Strict `===`
// on the raw values matched nothing, so selecting (or auto-selecting) a
// resource emptied the whole calendar on Postgres installs.
describe('reservationMatchesResource', () => {
  it('matches a numeric top-level resource id against a string selection', () => {
    expect(reservationMatchesResource({ resource: 8 as unknown as string }, '8')).toBe(true)
  })

  it('matches a populated resource object with a numeric id', () => {
    expect(reservationMatchesResource({ resource: { id: 8 as unknown as string } }, '8')).toBe(true)
  })

  it('matches string ids (Mongo installs) exactly as before', () => {
    expect(reservationMatchesResource({ resource: 'abc123' }, 'abc123')).toBe(true)
  })

  it('matches via items[].resource for multi-resource bookings', () => {
    expect(
      reservationMatchesResource({ items: [{ resource: { id: 8 as unknown as string } }] }, '8'),
    ).toBe(true)
  })

  it('empty selection matches everything', () => {
    expect(reservationMatchesResource({}, '')).toBe(true)
  })

  it('non-matching and missing resources do not match', () => {
    expect(reservationMatchesResource({ resource: 9 as unknown as string }, '8')).toBe(false)
    expect(reservationMatchesResource({}, '8')).toBe(false)
    expect(reservationMatchesResource({ items: [{}] }, '8')).toBe(false)
  })

  it('sameId never matches null/undefined and never coerces 8 to match 80', () => {
    expect(sameId(null, '8')).toBe(false)
    expect(sameId(undefined, undefined)).toBe(false)
    expect(sameId(8, '80')).toBe(false)
    expect(sameId(8, '8')).toBe(true)
  })
})

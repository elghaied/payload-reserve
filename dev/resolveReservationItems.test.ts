import { describe, expect, it } from 'vitest'

import { extractId, resolveReservationItems } from '../src/utilities/resolveReservationItems.js'

describe('extractId', () => {
  it('returns string ids unchanged', () => {
    expect(extractId('abc')).toBe('abc')
    expect(extractId('mongo-objectid-123')).toBe('mongo-objectid-123')
  })

  it('returns numeric ids unchanged (Postgres adapter case)', () => {
    expect(extractId(42)).toBe(42)
    expect(extractId(1)).toBe(1)
  })

  it('returns numeric id 0 rather than treating it as missing', () => {
    // 0 is a valid Postgres id; the function returns it so callers can decide.
    expect(extractId(0)).toBe(0)
  })

  it('returns nested id when given a populated relationship document', () => {
    expect(extractId({ id: 7 })).toBe(7)
    expect(extractId({ id: 'mongo-id' })).toBe('mongo-id')
    expect(extractId({ id: 42, name: 'extra-field-ignored' })).toBe(42)
  })

  it('returns undefined for empty/missing values', () => {
    expect(extractId(undefined)).toBeUndefined()
    expect(extractId(null)).toBeUndefined()
    expect(extractId('')).toBeUndefined()
    expect(extractId({})).toBeUndefined()
  })
})

describe('resolveReservationItems', () => {
  it('passes through numeric ids from the Postgres adapter on single-resource bookings', () => {
    const items = resolveReservationItems({
      endTime: '2025-07-01T11:00:00.000Z',
      resource: 42,
      service: 7,
      startTime: '2025-07-01T10:00:00.000Z',
    })

    expect(items).toHaveLength(1)
    expect(items[0].resource).toBe(42)
    expect(items[0].service).toBe(7)
  })

  it('passes through string ids from the Mongo adapter on single-resource bookings', () => {
    const items = resolveReservationItems({
      endTime: '2025-07-01T11:00:00.000Z',
      resource: 'mongo-resource-id',
      service: 'mongo-service-id',
      startTime: '2025-07-01T10:00:00.000Z',
    })

    expect(items).toHaveLength(1)
    expect(items[0].resource).toBe('mongo-resource-id')
    expect(items[0].service).toBe('mongo-service-id')
  })

  it('resolves numeric ids inside multi-resource items[]', () => {
    const items = resolveReservationItems({
      items: [
        { resource: 1, service: 10, startTime: '2025-07-01T10:00:00.000Z' },
        { resource: 2, service: 20, startTime: '2025-07-01T10:00:00.000Z' },
      ],
    })

    expect(items).toHaveLength(2)
    expect(items[0].resource).toBe(1)
    expect(items[0].service).toBe(10)
    expect(items[1].resource).toBe(2)
    expect(items[1].service).toBe(20)
  })

  it('resolves populated relationship documents to their numeric ids', () => {
    const items = resolveReservationItems({
      resource: { id: 99, name: 'Room A' },
      service: { id: 5, duration: 60 },
      startTime: '2025-07-01T10:00:00.000Z',
    })

    expect(items).toHaveLength(1)
    expect(items[0].resource).toBe(99)
    expect(items[0].service).toBe(5)
  })

  it('returns empty array when single-resource fallback has no resource', () => {
    expect(resolveReservationItems({ startTime: '2025-07-01T10:00:00.000Z' })).toEqual([])
  })
})

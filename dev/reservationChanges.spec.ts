import { describe, expect, it } from 'vitest'

import {
  mergeReservationData,
  schedulingFieldsChanged,
} from '../src/utilities/reservationChanges.js'

const BLOCKING = ['pending', 'confirmed']

describe('mergeReservationData', () => {
  it('overlays data on originalDoc without mutating either', () => {
    const data = { startTime: '2025-08-01T10:00:00.000Z' }
    const originalDoc = { resource: 'r1', startTime: '2025-08-01T09:00:00.000Z' }
    const merged = mergeReservationData(data, originalDoc)
    expect(merged).toEqual({ resource: 'r1', startTime: '2025-08-01T10:00:00.000Z' })
    expect(data).toEqual({ startTime: '2025-08-01T10:00:00.000Z' })
    expect(originalDoc.startTime).toBe('2025-08-01T09:00:00.000Z')
  })

  it('tolerates a missing originalDoc', () => {
    expect(mergeReservationData({ resource: 'r1' }, undefined)).toEqual({ resource: 'r1' })
  })
})

describe('schedulingFieldsChanged', () => {
  const base = {
    guestCount: 2,
    resource: 'res-1',
    service: 'svc-1',
    startTime: '2025-08-01T10:00:00.000Z',
    status: 'pending',
  }

  it('returns true when originalDoc is missing (defensive)', () => {
    expect(
      schedulingFieldsChanged({ blockingStatuses: BLOCKING, data: {}, originalDoc: undefined }),
    ).toBe(true)
  })

  it('ignores fields not present in data', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { notes: 'arrived late' },
        originalDoc: base,
      }),
    ).toBe(false)
  })

  it('treats equal dates in different shapes as unchanged (Date vs ISO string)', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { startTime: new Date('2025-08-01T10:00:00.000Z') },
        originalDoc: base,
      }),
    ).toBe(false)
  })

  it('detects a startTime change', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { startTime: '2025-08-01T11:00:00.000Z' },
        originalDoc: base,
      }),
    ).toBe(true)
  })

  it('compares relationships by id (populated object vs scalar)', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { resource: { id: 'res-1', name: 'Room' } },
        originalDoc: base,
      }),
    ).toBe(false)
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { resource: { id: 'res-2' } },
        originalDoc: base,
      }),
    ).toBe(true)
  })

  it('detects a guestCount change and treats null/undefined as equal', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { guestCount: 3 },
        originalDoc: base,
      }),
    ).toBe(true)
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { guestCount: null },
        originalDoc: { ...base, guestCount: undefined },
      }),
    ).toBe(false)
  })

  it('compares items per entry, ignoring extra keys like id', () => {
    const originalDoc = {
      ...base,
      items: [
        {
          id: 'row-1',
          endTime: '2025-08-01T11:00:00.000Z',
          resource: 'res-1',
          startTime: '2025-08-01T10:00:00.000Z',
        },
      ],
    }
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: {
          items: [
            {
              endTime: new Date('2025-08-01T11:00:00.000Z'),
              resource: { id: 'res-1' },
              startTime: '2025-08-01T10:00:00.000Z',
            },
          ],
        },
        originalDoc,
      }),
    ).toBe(false)
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: {
          items: [
            {
              endTime: '2025-08-01T11:00:00.000Z',
              resource: 'res-1',
              startTime: '2025-08-01T10:30:00.000Z',
            },
          ],
        },
        originalDoc,
      }),
    ).toBe(true)
    expect(
      schedulingFieldsChanged({ blockingStatuses: BLOCKING, data: { items: [] }, originalDoc }),
    ).toBe(true)
  })

  it('status: only a non-blocking -> blocking move counts as a scheduling change', () => {
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { status: 'completed' },
        originalDoc: base,
      }),
    ).toBe(false)
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { status: 'confirmed' },
        originalDoc: base,
      }),
    ).toBe(false)
    expect(
      schedulingFieldsChanged({
        blockingStatuses: BLOCKING,
        data: { status: 'confirmed' },
        originalDoc: { ...base, status: 'cancelled' },
      }),
    ).toBe(true)
  })

  it('applies the status clause only when blockingStatuses is supplied', () => {
    // 'draft' is not blocking, 'confirmed' is — so the status clause fires when
    // blockingStatuses is supplied...
    const args = { data: { status: 'confirmed' }, originalDoc: { status: 'draft' } }
    expect(schedulingFieldsChanged({ ...args, blockingStatuses: ['confirmed'] })).toBe(true)
    // ...and is skipped entirely when it is omitted. validateActive omits it for
    // exactly this reason: otherwise confirming a booking would count as a
    // scheduling change and strand it once its resource was deactivated.
    expect(schedulingFieldsChanged(args)).toBe(false)
  })

  it('still reports a startTime change when blockingStatuses is omitted', () => {
    expect(
      schedulingFieldsChanged({
        data: { startTime: '2030-01-01T10:00:00.000Z' },
        originalDoc: { startTime: '2030-01-01T09:00:00.000Z' },
      }),
    ).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { resolveReservationItems } from '../src/utilities/resolveReservationItems.js'

const START = '2026-09-01T10:00:00.000Z'

describe('resolveReservationItems — parent synthesis (B1)', () => {
  it('adds the top-level resource when items[] omits it', () => {
    const items = resolveReservationItems({
      endTime: '2026-09-01T10:30:00.000Z',
      items: [{ resource: 'B', startTime: START }],
      resource: 'A',
      service: 'svc',
      startTime: START,
    })
    expect(items.map((i) => i.resource)).toEqual(['B', 'A'])
    expect(items[1].fromParent).toBe(true)
    expect(items[0].fromParent).toBeUndefined()
  })

  it('does not duplicate the parent when items[] already contains it', () => {
    const items = resolveReservationItems({
      items: [{ resource: 'A', startTime: START }],
      resource: 'A',
      startTime: START,
    })
    expect(items).toHaveLength(1)
    expect(items[0].fromParent).toBeUndefined()
  })

  it('still rejects caller-supplied duplicate pairs', () => {
    expect(() =>
      resolveReservationItems({
        items: [
          { resource: 'B', startTime: START },
          { resource: 'B', startTime: START },
        ],
        resource: 'A',
        startTime: START,
      }),
    ).toThrow()
  })

  it('leaves the no-items fallback unchanged', () => {
    const items = resolveReservationItems({ resource: 'A', startTime: START })
    expect(items).toHaveLength(1)
    expect(items[0].fromParent).toBeUndefined()
  })

  it('skips synthesis when the parent has no resource', () => {
    const items = resolveReservationItems({
      items: [{ resource: 'B', startTime: START }],
      startTime: START,
    })
    expect(items).toHaveLength(1)
  })

  it('B1 regression: still synthesises when the same resource is itemized at a non-overlapping time', () => {
    // Reviewer-caught gap: dedup keyed on "resource id appears anywhere in
    // items[]" would treat items[] naming resource 'A' on 2026-09-02 as already
    // covering a top-level booking of 'A' on 2026-09-01 — a different day
    // entirely. This is exactly the shape resolveReservationItems sees from
    // validateConflicts once calculateEndTime's single-resource branch has run:
    // the top-level endTime is the PARENT's own startTime + duration, and the
    // items[] entry (an unrelated day) has no endTime of its own yet.
    const items = resolveReservationItems({
      endTime: '2026-09-01T11:00:00.000Z',
      items: [{ resource: 'A', startTime: '2026-09-02T10:00:00.000Z' }],
      resource: 'A',
      service: 'svc',
      startTime: '2026-09-01T10:00:00.000Z',
    })

    const parentItem = items.find((i) => i.fromParent)
    expect(items).toHaveLength(2)
    expect(parentItem).toBeDefined()
    expect(parentItem?.startTime).toBe('2026-09-01T10:00:00.000Z')
  })

  it('does not re-synthesise when an items[] entry for the same resource overlaps the (possibly spanned) parent window', () => {
    // Non-regression for the fix above: calculateEndTime's multi-resource
    // branch can overwrite the top-level startTime/endTime to SPAN every item
    // (earliest start -> latest end), so the parent's window no longer starts
    // at the same instant as the item that shares its resource — but it still
    // fully contains that item's own window, so no synthesis should occur.
    const items = resolveReservationItems({
      endTime: '2026-09-01T11:00:00.000Z', // spanned: covers 08:00-11:00
      items: [
        { endTime: '2026-09-01T11:00:00.000Z', resource: 'A', startTime: '2026-09-01T10:00:00.000Z' },
        { endTime: '2026-09-01T09:00:00.000Z', resource: 'B', startTime: '2026-09-01T08:00:00.000Z' },
      ],
      resource: 'A',
      service: 'svc',
      startTime: '2026-09-01T08:00:00.000Z', // spanned to the earliest item's start
    })

    expect(items).toHaveLength(2)
    expect(items.some((i) => i.fromParent)).toBe(false)
  })
})

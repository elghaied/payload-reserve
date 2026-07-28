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
})

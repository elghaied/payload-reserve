import { describe, expect, it } from 'vitest'

import { computeSlotStates } from '../src/utilities/computeSlotStates.js'

const base = {
  busy: [],
  capacityMode: 'per-reservation' as const,
  dayEnd: new Date('2026-08-10T12:00:00.000Z'),
  dayStart: new Date('2026-08-10T09:00:00.000Z'),
  quantity: 1,
  shiftWindows: [{ end: '2026-08-10T12:00:00.000Z', start: '2026-08-10T09:00:00.000Z' }],
  step: 60,
  timeOff: [],
}

describe('computeSlotStates external', () => {
  it('marks slots overlapping an external interval as external', () => {
    const slots = computeSlotStates({
      ...base,
      external: [{ end: '2026-08-10T11:00:00.000Z', start: '2026-08-10T10:00:00.000Z' }],
    })
    expect(slots.map((s) => s.state)).toEqual(['free', 'external', 'free'])
  })

  it('a slot both booked and external renders full (booking wins)', () => {
    const slots = computeSlotStates({
      ...base,
      busy: [{ end: '2026-08-10T11:00:00.000Z', start: '2026-08-10T10:00:00.000Z', units: 1 }],
      external: [{ end: '2026-08-10T11:00:00.000Z', start: '2026-08-10T10:00:00.000Z' }],
    })
    expect(slots.map((s) => s.state)).toEqual(['free', 'full', 'free'])
  })

  it('omitted external param keeps prior behavior', () => {
    const slots = computeSlotStates(base)
    expect(slots.map((s) => s.state)).toEqual(['free', 'free', 'free'])
  })
})

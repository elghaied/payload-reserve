import { addMinutes, doRangesOverlap } from './slotUtils.js'

export type SlotState = 'free' | 'full' | 'off-shift' | 'time-off'

export type SlotInfo = {
  end: Date
  occupancy: number
  start: Date
  state: SlotState
}

type Interval = { end: string; start: string }

const within = (slotStart: Date, slotEnd: Date, windows: Interval[]): boolean =>
  windows.some((w) => doRangesOverlap(slotStart, slotEnd, new Date(w.start), new Date(w.end)))

/**
 * Classify each step-sized slot in [dayStart, dayEnd) for a single resource.
 * Pure — no DB, no clock.
 */
export function computeSlotStates(params: {
  busy: Array<{ end: string; start: string; units: number }>
  capacityMode: 'per-guest' | 'per-reservation'
  dayEnd: Date
  dayStart: Date
  quantity: number
  shiftWindows: Interval[]
  step: number
  timeOff: Interval[]
}): SlotInfo[] {
  const { busy, dayEnd, dayStart, quantity, shiftWindows, step, timeOff } = params
  const slots: SlotInfo[] = []

  let cursor = new Date(dayStart)
  while (cursor < dayEnd) {
    const slotStart = new Date(cursor)
    const slotEnd = addMinutes(slotStart, step)

    let occupancy = 0
    for (const b of busy) {
      if (doRangesOverlap(slotStart, slotEnd, new Date(b.start), new Date(b.end))) {
        occupancy += b.units
      }
    }

    let state: SlotState
    if (!within(slotStart, slotEnd, shiftWindows)) {
      state = 'off-shift'
    } else if (within(slotStart, slotEnd, timeOff)) {
      state = 'time-off'
    } else if (occupancy >= quantity) {
      state = 'full'
    } else {
      state = 'free'
    }

    slots.push({ end: slotEnd, occupancy, start: slotStart, state })
    cursor = slotEnd
  }

  return slots
}

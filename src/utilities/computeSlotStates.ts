import { addMinutes, doRangesOverlap } from './slotUtils.js'

export type SlotState = 'free' | 'full' | 'off-shift' | 'time-off'

export type SlotInfo = {
  end: Date
  occupancy: number
  start: Date
  state: SlotState
}

type Busy = Array<{ end: string; start: string; units: number }>
type Interval = { end: string; start: string }
type RequiredPool = { busy: Busy; quantity: number }

const within = (slotStart: Date, slotEnd: Date, windows: Interval[]): boolean =>
  windows.some((w) => doRangesOverlap(slotStart, slotEnd, new Date(w.start), new Date(w.end)))

/** Sum the `units` of busy intervals overlapping [slotStart, slotEnd). */
const occupancyAt = (slotStart: Date, slotEnd: Date, busy: Busy): number => {
  let occ = 0
  for (const b of busy) {
    if (doRangesOverlap(slotStart, slotEnd, new Date(b.start), new Date(b.end))) {
      occ += b.units
    }
  }
  return occ
}

/**
 * Classify each step-sized slot in [dayStart, dayEnd) for a single resource.
 * A slot is `full` when the resource itself is at capacity OR any of its
 * `requiredPools` (e.g. a shared chair pool a service also needs) is at
 * capacity — so the grid reflects true bookability, not just the stylist.
 * Pure — no DB, no clock.
 */
export function computeSlotStates(params: {
  busy: Busy
  capacityMode: 'per-guest' | 'per-reservation'
  dayEnd: Date
  dayStart: Date
  quantity: number
  requiredPools?: RequiredPool[]
  shiftWindows: Interval[]
  step: number
  timeOff: Interval[]
}): SlotInfo[] {
  const { busy, dayEnd, dayStart, quantity, requiredPools, shiftWindows, step, timeOff } = params
  const pools = requiredPools ?? []
  const slots: SlotInfo[] = []

  let cursor = new Date(dayStart)
  while (cursor < dayEnd) {
    const slotStart = new Date(cursor)
    const slotEnd = addMinutes(slotStart, step)

    const occupancy = occupancyAt(slotStart, slotEnd, busy)
    const poolFull = pools.some((p) => occupancyAt(slotStart, slotEnd, p.busy) >= p.quantity)

    let state: SlotState
    if (!within(slotStart, slotEnd, shiftWindows)) {
      state = 'off-shift'
    } else if (within(slotStart, slotEnd, timeOff)) {
      state = 'time-off'
    } else if (occupancy >= quantity || poolFull) {
      state = 'full'
    } else {
      state = 'free'
    }

    slots.push({ end: slotEnd, occupancy, start: slotStart, state })
    cursor = slotEnd
  }

  return slots
}

import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { resolveComponentSlot } from '../src/utilities/componentSlots.js'

const FALLBACK = 'payload-reserve/client#CalendarView'

describe('resolveComponentSlot', () => {
  it('uses the plugin default when the slot is unset', () => {
    expect(resolveComponentSlot(undefined, FALLBACK)).toBe(FALLBACK)
  })

  it('uses the consumer path when the slot is a string', () => {
    expect(resolveComponentSlot('my-app/components#MyCalendar', FALLBACK)).toBe(
      'my-app/components#MyCalendar',
    )
  })

  it('returns undefined when the slot is false, meaning do not register', () => {
    expect(resolveComponentSlot(false, FALLBACK)).toBeUndefined()
  })

  it('returns the empty string unchanged, rather than coercing it to the fallback', () => {
    // '' is a string, so it takes the `typeof override === 'string'` branch —
    // not falsy-coerced to the fallback. Behaviour is correct by inspection;
    // this pins it down.
    expect(resolveComponentSlot('', FALLBACK)).toBe('')
  })
})

describe('resolveConfig components', () => {
  it('defaults to an empty object', () => {
    expect(resolveConfig({}).components).toEqual({})
  })

  it('passes the supplied slots through unchanged', () => {
    const components = { calendarView: false as const, reservationDetail: '/x.tsx#X' }
    expect(resolveConfig({ components }).components).toEqual(components)
  })
})

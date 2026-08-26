import { describe, expect, it } from 'vitest'

import { resolveActiveView, visibleCalendarViews } from '../src/utilities/calendarViews.js'

const ALL = ['month', 'week', 'day', 'lanes', 'pending'] as const

describe('visibleCalendarViews', () => {
  it('returns every view when nothing is hidden', () => {
    expect(visibleCalendarViews([...ALL], undefined)).toEqual([...ALL])
    expect(visibleCalendarViews([...ALL], [])).toEqual([...ALL])
  })

  it('removes the hidden views and preserves order', () => {
    expect(visibleCalendarViews([...ALL], ['lanes', 'pending'])).toEqual(['month', 'week', 'day'])
  })

  it('ignores a hidden view that is not a real view', () => {
    expect(visibleCalendarViews([...ALL], ['nope' as never])).toEqual([...ALL])
  })

  it('never returns an empty toolbar', () => {
    // Hiding everything would leave the user with no way to navigate; month wins.
    expect(visibleCalendarViews([...ALL], [...ALL])).toEqual(['month'])
  })
})

describe('resolveActiveView', () => {
  it('keeps the active view when it is visible', () => {
    expect(resolveActiveView('week', ['lanes'])).toBe('week')
  })

  it('falls back to month when the active view is hidden', () => {
    expect(resolveActiveView('pending', ['lanes', 'pending'])).toBe('month')
  })

  it('keeps the active view when nothing is hidden', () => {
    expect(resolveActiveView('lanes', undefined)).toBe('lanes')
  })
})

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
    expect(resolveActiveView('week', ['month', 'week', 'day', 'pending'])).toBe('week')
  })

  it('falls back to the first visible view when the active view is hidden', () => {
    expect(resolveActiveView('pending', ['month', 'week', 'day'])).toBe('month')
  })

  it('keeps the active view when nothing is hidden', () => {
    expect(resolveActiveView('lanes', [...ALL])).toBe('lanes')
  })

  it('regression: falls back to the first visible view, not a hardcoded "month", when month itself is hidden', () => {
    // hiddenViews: ['month'] is exactly the case the old hardcoded-'month'
    // fallback got wrong: 'month' is itself hidden, so it must never be the
    // resolved answer.
    const visible = visibleCalendarViews([...ALL], ['month'])
    expect(visible).toEqual(['week', 'day', 'lanes', 'pending'])
    expect(resolveActiveView('month', visible)).toBe('week')
    expect(resolveActiveView('month', visible)).not.toBe('month')
  })

  it('regression: hiding month and week falls back to the first remaining view', () => {
    const visible = visibleCalendarViews([...ALL], ['month', 'week'])
    expect(visible).toEqual(['day', 'lanes', 'pending'])
    expect(resolveActiveView('month', visible)).toBe('day')
  })
})

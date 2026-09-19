import { describe, expect, it } from 'vitest'

import {
  initialCalendarView,
  resolveActiveView,
  visibleCalendarViews,
  weekdayLabels,
} from '../src/utilities/calendarViews.js'

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

describe('initialCalendarView', () => {
  it('falls back to month when nothing is configured', () => {
    expect(initialCalendarView({ isMobile: false, visible: [...ALL] })).toBe('month')
    expect(initialCalendarView({ isMobile: true, visible: [...ALL] })).toBe('month')
  })

  it('uses defaultView on desktop', () => {
    expect(initialCalendarView({ defaultView: 'week', isMobile: false, visible: [...ALL] })).toBe(
      'week',
    )
  })

  it('uses defaultView on mobile when mobileDefaultView is unset', () => {
    expect(initialCalendarView({ defaultView: 'week', isMobile: true, visible: [...ALL] })).toBe(
      'week',
    )
  })

  it('prefers mobileDefaultView on mobile only', () => {
    const args = { defaultView: 'week' as const, mobileDefaultView: 'day' as const, visible: [...ALL] }
    expect(initialCalendarView({ ...args, isMobile: true })).toBe('day')
    expect(initialCalendarView({ ...args, isMobile: false })).toBe('week')
  })

  it('resolves a hidden pick to the first visible view', () => {
    const visible = visibleCalendarViews([...ALL], ['week'])
    expect(initialCalendarView({ defaultView: 'week', isMobile: false, visible })).toBe('month')
  })
})

describe('weekdayLabels', () => {
  const t = (key: string) => key.replace('reservation:dayShort', '')
  it('starts on Sunday by default', () => {
    expect(weekdayLabels(t)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })
  it('rotates to the configured first day', () => {
    expect(weekdayLabels(t, 1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayLabels(t, 6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })
})

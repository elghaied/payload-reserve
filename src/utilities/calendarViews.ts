import type { ReservationCalendarViewMode } from '../types.js'

/**
 * Filter the calendar's view tabs by a consumer's `hiddenViews`.
 *
 * Never returns an empty list: hiding every view would leave the toolbar with
 * no way to navigate, so `month` survives as the floor.
 */
export function visibleCalendarViews(
  all: ReservationCalendarViewMode[],
  hidden: ReservationCalendarViewMode[] | undefined,
): ReservationCalendarViewMode[] {
  if (!hidden?.length) {return all}
  const hiddenSet = new Set(hidden)
  const visible = all.filter((view) => !hiddenSet.has(view))
  return visible.length > 0 ? visible : ['month']
}

/**
 * Guard against landing on a hidden tab. Unreachable today (the calendar
 * initialises to `month`), but a persisted preference or a changed default
 * would otherwise strand the user on an invisible view.
 */
export function resolveActiveView(
  active: ReservationCalendarViewMode,
  hidden: ReservationCalendarViewMode[] | undefined,
): ReservationCalendarViewMode {
  return hidden?.includes(active) ? 'month' : active
}

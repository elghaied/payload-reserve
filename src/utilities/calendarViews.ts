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
 * Guard against landing on a hidden tab. Resolves against the already-computed
 * `visible` list rather than a hardcoded `'month'` fallback, because `month`
 * itself may be hidden (e.g. `hiddenViews: ['month']`) — in that case falling
 * back to a hidden view would leave the toolbar with nothing highlighted.
 * `visible[0]` is always defined because `visibleCalendarViews` never returns
 * an empty list.
 */
export function resolveActiveView(
  active: ReservationCalendarViewMode,
  visible: ReservationCalendarViewMode[],
): ReservationCalendarViewMode {
  return visible.includes(active) ? active : visible[0]
}

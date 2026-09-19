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

/** Every view the toolbar can show, in toolbar order. */
export const CALENDAR_VIEW_MODES: readonly ReservationCalendarViewMode[] = [
  'month',
  'week',
  'day',
  'lanes',
  'pending',
]

/**
 * The view the calendar opens on. `mobileDefaultView` wins on a phone, then
 * `defaultView`, then `month`; the pick is then resolved against `visible`
 * so a hidden default still lands on a tab that exists.
 */
export function initialCalendarView(args: {
  defaultView?: ReservationCalendarViewMode
  isMobile: boolean
  mobileDefaultView?: ReservationCalendarViewMode
  visible: ReservationCalendarViewMode[]
}): ReservationCalendarViewMode {
  const picked =
    (args.isMobile ? args.mobileDefaultView : undefined) ?? args.defaultView ?? 'month'
  return resolveActiveView(picked, args.visible)
}

const DAY_SHORT_KEYS = [
  'reservation:dayShortSun',
  'reservation:dayShortMon',
  'reservation:dayShortTue',
  'reservation:dayShortWed',
  'reservation:dayShortThu',
  'reservation:dayShortFri',
  'reservation:dayShortSat',
] as const

/** The seven short weekday labels, starting on `weekStartsOn` (0 = Sunday). */
export function weekdayLabels(t: (key: string) => string, weekStartsOn = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => t(DAY_SHORT_KEYS[(i + weekStartsOn) % 7]))
}

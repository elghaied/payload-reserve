import type { ResolvedReservationPluginConfig } from '../types.js'

/**
 * Validate the window of a `flexible`-duration booking or hold.
 *
 * The service `duration` is the documented minimum (docs/booking-features.md has
 * said so since the field shipped, but nothing enforced it) and
 * `maxFlexibleDuration` is the ceiling. Without the ceiling one request —
 * `/reserve/book` for any customer, `/reserve/hold` for anyone at all — could
 * occupy a resource until 2099: every later availability read and every write
 * for that resource then fails. Returns a message, or `null` when the window is
 * acceptable.
 */
export function flexibleWindowProblem({
  config,
  end,
  service,
  start,
}: {
  config: Pick<ResolvedReservationPluginConfig, 'maxFlexibleDuration'>
  end: Date
  service: { duration?: null | number }
  start: Date
}): null | string {
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) {
    return 'endTime is not a valid date'
  }
  if (end <= start) {
    return 'endTime must be after startTime'
  }
  const minutes = (end.getTime() - start.getTime()) / 60_000
  const min = service.duration ?? 0
  if (min > 0 && minutes < min) {
    return `endTime must be at least ${min} minutes after startTime`
  }
  if (minutes > config.maxFlexibleDuration) {
    return `Flexible bookings cannot exceed ${config.maxFlexibleDuration} minutes`
  }
  return null
}

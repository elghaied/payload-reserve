import type { ReservationComponentSlot } from '../types.js'

/**
 * Pick the component path for one slot.
 *
 * Returns `undefined` for `false`, which every call site treats as "do not write
 * a component into Payload config at all" — which in turn means Payload's own
 * default applies (or, for the dashboard widget and the availability view, that
 * nothing is registered).
 */
export function resolveComponentSlot(
  override: ReservationComponentSlot | undefined,
  fallback: string,
): string | undefined {
  if (override === false) {
    return undefined
  }
  if (typeof override === 'string') {
    return override
  }
  return fallback
}

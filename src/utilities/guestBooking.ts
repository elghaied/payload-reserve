/** Tri-state per-service guest booking setting. */
export type GuestBookingSetting = 'disabled' | 'enabled' | 'inherit'

/**
 * Resolve whether guest bookings are allowed for a service.
 * 'enabled'/'disabled' on the service win; 'inherit' (or unset) falls back to
 * the plugin-level default.
 */
export function resolveGuestBookingAllowed(
  service: { allowGuestBooking?: GuestBookingSetting | null } | null | undefined,
  pluginDefault: boolean,
): boolean {
  const value = service?.allowGuestBooking
  if (value === 'enabled') {
    return true
  }
  if (value === 'disabled') {
    return false
  }
  return pluginDefault
}

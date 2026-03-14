/**
 * Convert a status string to its i18n translation key.
 * Handles hyphenated statuses by converting to camelCase.
 *
 * Examples:
 *   'pending'   → 'reservation:statusPending'
 *   'no-show'   → 'reservation:statusNoShow'
 */
export function statusToI18nKey(status: string): string {
  const camel = status.charAt(0).toUpperCase() + status.slice(1).replace(/-./g, (m) => m[1].toUpperCase())
  return `reservation:status${camel}`
}

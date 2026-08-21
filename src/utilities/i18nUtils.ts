/**
 * Camel-cases a hyphenated/plain status for use in an i18n key suffix.
 *
 * Examples:
 *   'pending'   → 'Pending'
 *   'no-show'   → 'NoShow'
 */
function camelCaseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/-./g, (m) => m[1].toUpperCase())
}

/**
 * Convert a status string to its i18n translation key.
 * Handles hyphenated statuses by converting to camelCase.
 *
 * Examples:
 *   'pending'   → 'reservation:statusPending'
 *   'no-show'   → 'reservation:statusNoShow'
 */
export function statusToI18nKey(status: string): string {
  return `reservation:status${camelCaseStatus(status)}`
}

/**
 * Convert a status string to its ACTION-label i18n key — the verb a button
 * transitioning TO this status should read (e.g. "Confirm" rather than
 * "Confirmed"). Mirrors `statusToI18nKey`, just under the `action` prefix.
 *
 * Examples:
 *   'confirmed' → 'reservation:actionConfirmed'
 *   'no-show'   → 'reservation:actionNoShow'
 */
export function statusToActionI18nKey(status: string): string {
  return `reservation:action${camelCaseStatus(status)}`
}

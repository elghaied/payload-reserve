/** The plugin's shipped default status machine (`src/defaults.ts`). */
export const DEFAULT_STATUS_MACHINE = {
  blockingStatuses: ['pending', 'confirmed'],
  cancelStatus: 'cancelled',
  confirmStatus: 'confirmed',
  defaultStatus: 'pending',
  statuses: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
  terminalStatuses: ['completed', 'cancelled', 'no-show'],
  transitions: {
    cancelled: [],
    completed: [],
    confirmed: ['completed', 'cancelled', 'no-show'],
    'no-show': [],
    pending: ['confirmed', 'cancelled'],
  },
}

/**
 * A vocabulary that shares no status name with the built-in machine — proof
 * that nothing downstream hardcodes `'cancelled'`/`'confirmed'`/etc.
 */
export const CUSTOM_STATUS_MACHINE = {
  blockingStatuses: ['submitted', 'accepted'],
  cancelStatus: 'declined',
  confirmStatus: 'accepted',
  defaultStatus: 'submitted',
  statuses: ['submitted', 'accepted', 'fulfilled', 'declined'],
  terminalStatuses: ['fulfilled', 'declined'],
  transitions: {
    accepted: ['fulfilled', 'declined'],
    declined: [],
    fulfilled: [],
    submitted: ['accepted', 'declined'],
  },
}

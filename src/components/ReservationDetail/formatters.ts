import type { CalendarReservation } from '../shared/types.js'

/**
 * Display name for whoever the booking is for.
 *
 * A booking has either a customer or a guest, never both. An unpopulated
 * relationship (a bare id string) yields the fallback rather than the id.
 */
export function formatCustomerName(reservation: CalendarReservation, fallback: string): string {
  const { customer, guest } = reservation

  if (customer && typeof customer === 'object') {
    if (customer.name) {
      return customer.name
    }
    const joined = [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    if (joined) {
      return joined
    }
  }

  if (guest) {
    return guest.name || guest.email || guest.phone || fallback
  }

  return fallback
}

/**
 * Locale-aware clock time (`HH:mm`) for an ISO instant, in the given IANA
 * timezone. `iso` is optional because it's used for both `startTime`
 * (required on `CalendarReservation`) and `endTime` (optional) — an
 * undefined/empty input renders as `'—'` rather than throwing or printing
 * `Invalid Date`.
 */
export function formatReservationTime(iso: string | undefined, timeZone: string): string {
  if (!iso) {
    return '—'
  }
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

/**
 * Locale-aware date label (weekday, day, short month) for an ISO instant, in
 * the given IANA timezone — e.g. `Thu, 1 Jan`.
 */
export function formatReservationDateLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short',
  })
}

/** Every populated resource name on the booking, top-level first, de-duplicated. */
export function formatResourceNames(reservation: CalendarReservation): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  const push = (value: CalendarReservation['resource']) => {
    if (!value || typeof value !== 'object' || !value.name) {
      return
    }
    const key = String(value.id ?? value.name)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    names.push(value.name)
  }

  push(reservation.resource)
  for (const item of reservation.items ?? []) {
    push(item.resource)
  }

  return names
}

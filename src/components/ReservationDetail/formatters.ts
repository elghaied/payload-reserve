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

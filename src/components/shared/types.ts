export type ReservationItem = {
  endTime?: string
  guestCount?: number
  resource?: { id?: string; name?: string } | string
  service?: { name?: string } | string
  startTime?: string
}

/**
 * The UI-shaped reservation shape the calendar and detail drawer work with —
 * deliberately loose (every relationship may arrive unpopulated as a bare id
 * string, or populated to whatever depth the fetch that produced it used).
 *
 * Named `CalendarReservation`, not `Reservation`, because it is exported from
 * the package root: `Reservation` there would collide conceptually with the
 * consumer's own generated `payload-types` `Reservation`, which is what a
 * plain `Reservation` import would be assumed to be.
 */
export type CalendarReservation = {
  cancellationReason?: string
  customer?: { firstName?: string; lastName?: string; name?: string } | string
  endTime?: string
  guest?: { email?: string; name?: string; phone?: string }
  guestCount?: number
  id: string
  items?: ReservationItem[]
  resource?: { id?: string; name?: string } | string
  service?: { name?: string } | string
  startTime: string
  status: string
}

export type ResourceOption = {
  id: string
  name: string
}

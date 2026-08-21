export type ReservationItem = {
  endTime?: string
  guestCount?: number
  resource?: { id?: string; name?: string } | string
  service?: { name?: string } | string
  startTime?: string
}

export type Reservation = {
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

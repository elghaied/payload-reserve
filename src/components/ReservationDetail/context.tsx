'use client'
import React, { createContext, useContext } from 'react'

import type { CalendarReservation } from '../shared/types.js'

export type ReservationDetailContextValue = {
  /** Close the detail drawer. */
  close: () => void
  /**
   * The open reservation, or null when the drawer is closed.
   *
   * This is the document the calendar already fetched at `depth: 1` — service,
   * resource, customer and items are populated, nothing else is. A component
   * needing more must fetch for itself.
   */
  doc: CalendarReservation | null
  /** Re-fetch the calendar's reservations so `doc` reflects a server change. */
  refresh: () => void
}

const ReservationDetailContext = createContext<null | ReservationDetailContextValue>(null)

export const ReservationDetailProvider: React.FC<{
  children: React.ReactNode
  value: ReservationDetailContextValue
}> = ({ children, value }) => (
  <ReservationDetailContext.Provider value={value}>{children}</ReservationDetailContext.Provider>
)

/**
 * Read the open reservation and the drawer controls.
 *
 * Only valid inside the reservation detail drawer, which CalendarView provides.
 * A `components.reservationDetail` component is always rendered there, so this
 * throws rather than returning null — a silent null would surface as a confusing
 * blank drawer instead of a clear mounting error.
 */
export function useReservationDetail(): ReservationDetailContextValue {
  const context = useContext(ReservationDetailContext)
  if (!context) {
    throw new Error(
      'useReservationDetail must be called inside the reservation detail drawer. ' +
        'Components registered via `components.reservationDetail` are rendered there ' +
        'by CalendarView; this hook cannot be used standalone.',
    )
  }
  return context
}

'use client'
import { useReservationDetail } from 'payload-reserve/client'
import React from 'react'

/**
 * Dev-only fixture for the `components.reservationDetail` slot, wired up only
 * when `RESERVE_DETAIL_SLOT=1` (see dev/payload.config.ts, following the `MT=1`
 * multi-tenant harness precedent).
 *
 * This is the only thing in the repo that proves a consumer-supplied
 * `reservationDetail` component actually renders inside the drawer, in place
 * of the plugin's own `ReservationDetail`: a distinctive marker (asserted by
 * `dev/e2e.spec.ts`) plus the real document it received from
 * `useReservationDetail()`, via the reservation id.
 */
export const ReservationDetailFixture: React.FC = () => {
  const { doc } = useReservationDetail()

  if (!doc) {
    return null
  }

  return (
    <div data-reservation-detail-fixture="true">
      RESERVE_DETAIL_SLOT_FIXTURE — reservation {doc.id}
    </div>
  )
}

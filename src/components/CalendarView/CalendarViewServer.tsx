import type { ListViewServerProps } from 'payload'

import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import React from 'react'

// Import the client component from the exports bundle, NOT a relative path.
// A relative server->client import works in dev and fails in production; see
// Payload's own contributor guidance. dev/buildArtifacts.spec.ts guards this.
import { CalendarView } from '../../exports/client.js'

/**
 * Server wrapper around the client CalendarView.
 *
 * Its only job is resolving an optional consumer-supplied reservation-detail
 * component out of `payload.importMap` — which a client component cannot do,
 * because the import map exists only on the server — and handing the client a
 * pre-rendered ELEMENT. Runtime data reaches that element through React context
 * (`useReservationDetail`), so nothing non-serializable crosses the boundary.
 */
export const CalendarViewServer: React.FC<ListViewServerProps> = (props) => {
  const { payload } = props

  const custom = payload.config.admin?.custom as
    | { reservationDetailComponent?: false | string }
    | undefined

  const detail = custom?.reservationDetailComponent

  const detailSlot =
    typeof detail === 'string'
      ? RenderServerComponent({ Component: detail, importMap: payload.importMap })
      : null

  // Do NOT spread `props`. ListViewServerProps carries non-serializable values
  // (i18n.t, the i18n.dateFNS locale functions, payload, collectionConfig.access).
  // Payload strips those when IT renders a client view; once this wrapper exists,
  // WE own the prop-passing and React throws "Functions cannot be passed directly
  // to Client Components". Anything added here must be checked for serializability.
  return <CalendarView detailDisabled={detail === false} detailSlot={detailSlot} />
}

'use client'
import { useConfig, useTranslation } from '@payloadcms/ui'
import { useCallback, useMemo } from 'react'

import type { PluginT } from '../../translations/index.js'
import type { MutationResult } from '../../utilities/reservationPatch.js'

import { performReservationPatch } from '../../utilities/reservationPatch.js'

export type { MutationResult } from '../../utilities/reservationPatch.js'

export type ReservationMutations = {
  /**
   * Transition to `status`, additionally recording a cancellation reason.
   *
   * The caller supplies the cancel status rather than this hook resolving it:
   * `useReservationStatusMachine` already resolves it (explicit config value,
   * else derived from transitions), and a second independent resolution here
   * would disagree with the button the user actually clicked.
   */
  cancel: (id: string, status: string, reason?: string) => Promise<MutationResult>
  /** Transition to any status the server will accept. */
  transition: (id: string, status: string) => Promise<MutationResult>
}

/**
 * Status mutations for a reservation.
 *
 * The server is the authority on which transitions are legal: `validateStatusTransition`
 * and `validateCancellation` both reject with a Payload `ValidationError` whose useful
 * text is nested (see `extractErrorMessage`). These functions never pre-judge a
 * transition — they attempt it and surface whatever the server says. The actual
 * request/response handling lives in `performReservationPatch`
 * (`src/utilities/reservationPatch.ts`) so it can be unit-tested without this hook's
 * `@payloadcms/ui` dependency; this hook is a thin binding over it.
 */
export function useReservationMutations(): ReservationMutations {
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const apiUrl = useMemo(() => {
    const slugs = config.admin?.custom?.reservationSlugs as Record<string, string> | undefined
    const slug = slugs?.reservations ?? 'reservations'
    return `${config.serverURL ?? ''}${config.routes.api}/${slug}`
  }, [config])

  const patch = useCallback(
    (id: string, data: Record<string, unknown>): Promise<MutationResult> =>
      performReservationPatch({
        data,
        fetchImpl: fetch,
        messages: {
          failure: t('reservation:detailStatusFailed'),
          network: t('reservation:detailNetworkError'),
          success: t('reservation:detailStatusChanged'),
        },
        url: `${apiUrl}/${id}`,
      }),
    [apiUrl, t],
  )

  const transition = useCallback((id: string, status: string) => patch(id, { status }), [patch])

  const cancel = useCallback(
    (id: string, status: string, reason?: string) =>
      patch(id, {
        ...(reason ? { cancellationReason: reason } : {}),
        status,
      }),
    [patch],
  )

  return useMemo(() => ({ cancel, transition }), [cancel, transition])
}

'use client'
import { useConfig, useTranslation } from '@payloadcms/ui'
import { useCallback, useMemo } from 'react'

import type { PluginT } from '../../translations/index.js'

import { extractErrorMessage } from '../../utilities/extractErrorMessage.js'

export type MutationResult = {
  /** Ready to display: the server's own message on failure, a success string otherwise. */
  message: string
  ok: boolean
}

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
 * transition — they attempt it and surface whatever the server says.
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
    async (id: string, data: Record<string, unknown>): Promise<MutationResult> => {
      let response: Response
      try {
        response = await fetch(`${apiUrl}/${id}`, {
          body: JSON.stringify(data),
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        })
      } catch {
        return { message: t('reservation:detailNetworkError'), ok: false }
      }

      if (response.ok) {
        return { message: t('reservation:detailStatusChanged'), ok: true }
      }

      // A non-JSON error body (a proxy 502, say) must not throw here.
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }

      return {
        message: extractErrorMessage(body, t('reservation:detailStatusFailed')),
        ok: false,
      }
    },
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

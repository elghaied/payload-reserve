'use client'
import { useConfig, useTranslation } from '@payloadcms/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import type { PluginT } from '../../translations/index.js'

import { useReservationMutations } from '../hooks/useReservationMutations.js'
import { useReservationStatusMachine } from '../hooks/useReservationStatusMachine.js'
import { DetailRow } from '../primitives/DetailRow/index.js'
import { StatusActionBar } from '../primitives/StatusActionBar/index.js'
import { StatusBadge } from '../primitives/StatusBadge/index.js'
import { useReservationDetail } from './context.js'
import { formatCustomerName, formatResourceNames } from './formatters.js'
import styles from './ReservationDetail.module.css'

export type ReservationDetailProps = {
  /** Called when the user chooses Edit; the calendar swaps to the document drawer. */
  onEdit?: (id: string) => void
}

/**
 * The plugin's default reservation detail body.
 *
 * Everything it uses is exported, so a consumer replacing it via
 * `components.reservationDetail` can rebuild it piece by piece rather than from
 * scratch. Read its imports as the worked example.
 */
export const ReservationDetail: React.FC<ReservationDetailProps> = ({ onEdit }) => {
  const { doc, refresh } = useReservationDetail()
  const { cancelStatus, labels, presentation, transitionsFrom } = useReservationStatusMachine()
  const { cancel, transition } = useReservationMutations()
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // This is a single persistent drawer whose `doc` is swapped in place as the
  // calendar routes different reservations through it (see context.tsx). A
  // mutation kicked off against one reservation must never paint its result
  // onto a different, later-opened one: this ref tracks the *currently* open
  // id (updated every render, ahead of the effect below) so an in-flight
  // request can tell, after it resolves, whether it is still looking at the
  // reservation it started against.
  const openIdRef = useRef(doc?.id)
  openIdRef.current = doc?.id

  // Reset local, per-reservation UI state whenever the open reservation
  // changes — otherwise a stale success/error banner (or a stuck `busy`) from
  // the previous reservation would bleed into the next one until the user
  // takes a new action.
  useEffect(() => {
    setFeedback(null)
    setBusy(false)
  }, [doc?.id])

  const timeZone =
    ((config.admin?.custom as Record<string, unknown> | undefined)?.reservationTimezone as
      | string
      | undefined) ?? 'UTC'

  const handleSelect = useCallback(
    async (target: string) => {
      if (!doc) {
        return
      }

      // The reservation this particular request was made against. If the
      // drawer has since moved on to a different reservation by the time this
      // resolves, its result belongs to a reservation that is no longer open.
      const requestId = doc.id

      // The cancel transition is the only one that collects extra input. It is
      // identified by the configured cancelStatus, never by the literal
      // 'cancelled', so a custom vocabulary keeps the prompt.
      let reason: null | string = null
      if (target === cancelStatus) {
        reason = window.prompt(t('reservation:detailCancelPrompt')) ?? null
        if (reason === null) {
          return
        }
      }

      setBusy(true)
      const result =
        target === cancelStatus
          ? await cancel(doc.id, cancelStatus, reason || undefined)
          : await transition(doc.id, target)

      // The mutation itself changed server state regardless of what is
      // currently open in the drawer, so the calendar's own list still needs
      // to reflect it.
      if (result.ok) {
        refresh()
      }

      // But the drawer's own busy/feedback state belongs to whichever
      // reservation is open NOW — never overwrite it with a stale result for
      // a reservation the user has already navigated away from.
      if (openIdRef.current !== requestId) {
        return
      }

      setBusy(false)
      setFeedback({ ok: result.ok, text: result.message })
    },
    [cancel, cancelStatus, doc, refresh, t, transition],
  )

  if (!doc) {
    return null
  }

  const serviceName =
    typeof doc.service === 'object' && doc.service?.name
      ? doc.service.name
      : t('reservation:detailTitle')

  const formatTime = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone,
        })
      : '—'

  const dateLabel = new Date(doc.startTime).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short',
  })

  const resourceNames = formatResourceNames(doc)
  const [primaryResource, ...additionalResources] = resourceNames
  const isGuest = Boolean(doc.guest && !doc.customer)
  const hasActions = transitionsFrom(doc.status).length > 0

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.service}>{serviceName}</div>
        <div className={styles.when}>
          {dateLabel} &middot; {formatTime(doc.startTime)} – {formatTime(doc.endTime)}
        </div>
        <div className={styles.badgeRow}>
          <StatusBadge
            label={labels[doc.status] ?? doc.status}
            presentation={presentation[doc.status]}
          />
        </div>
      </div>

      <div>
        <DetailRow
          label={isGuest ? t('reservation:detailGuest') : t('reservation:detailCustomer')}
          value={formatCustomerName(doc, '—')}
        />
        <DetailRow label={t('reservation:detailResource')} value={primaryResource ?? '—'} />
        {typeof doc.guestCount === 'number' && (
          <DetailRow label={t('reservation:detailGuests')} value={String(doc.guestCount)} />
        )}
        {additionalResources.length > 0 && (
          <DetailRow label={t('reservation:detailAlsoBooks')}>
            <span className={styles.pills}>
              {additionalResources.map((name) => (
                <span className={styles.pill} key={name}>
                  {name}
                </span>
              ))}
            </span>
          </DetailRow>
        )}
        {doc.cancellationReason && (
          <DetailRow
            label={t('reservation:detailCancellationReason')}
            value={doc.cancellationReason}
          />
        )}
      </div>

      {feedback && (
        <div
          className={`${styles.feedback} ${
            feedback.ok ? styles.feedbackSuccess : styles.feedbackError
          }`}
          role="status"
        >
          {feedback.text}
        </div>
      )}

      <div className={styles.footer}>
        {hasActions ? (
          <StatusActionBar busy={busy} onSelect={(s) => void handleSelect(s)} status={doc.status} />
        ) : (
          <span className={styles.noActions}>{t('reservation:detailNoActions')}</span>
        )}
        {onEdit && (
          <button className={styles.editButton} onClick={() => onEdit(doc.id)} type="button">
            {t('reservation:detailEdit')}
          </button>
        )}
      </div>
    </div>
  )
}

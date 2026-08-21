'use client'
import React from 'react'

import { useReservationStatusMachine } from '../../hooks/useReservationStatusMachine.js'
import styles from './StatusActionBar.module.css'

export type StatusActionBarProps = {
  /** Disables every button — set while a mutation is in flight. */
  busy?: boolean
  /**
   * Rendered instead of the bar when `status` has no outgoing transitions.
   * Defaults to `null` (renders nothing), same as before this prop existed —
   * a caller that needs a "no actions available" message can supply it here
   * rather than re-deriving `transitionsFrom(status).length === 0` itself.
   */
  noActionsFallback?: React.ReactNode
  onSelect: (status: string) => void
  /** The reservation's current status. */
  status: string
}

/**
 * Renders the transitions available from `status`, straight from the configured
 * status machine — including the transition to `cancelStatus`, which callers
 * handle specially (a reason prompt) rather than rendering separately.
 *
 * These are *candidates*, not permissions. The server re-validates every
 * transition, so a button here may still be refused; callers surface that
 * refusal rather than trying to predict it.
 */
export const StatusActionBar: React.FC<StatusActionBarProps> = ({
  busy,
  noActionsFallback = null,
  onSelect,
  status,
}) => {
  const { labels, transitionsFrom } = useReservationStatusMachine()
  const next = transitionsFrom(status)

  if (next.length === 0) {
    return noActionsFallback
  }

  return (
    <div className={styles.bar}>
      {next.map((target) => (
        <button
          className={styles.button}
          disabled={busy}
          key={target}
          onClick={() => onSelect(target)}
          type="button"
        >
          {labels[target] ?? target}
        </button>
      ))}
    </div>
  )
}

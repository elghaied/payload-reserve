'use client'
import React from 'react'

import type { StatusPresentation } from '../../../utilities/statusPresentation.js'
import type { CalendarReservation } from '../../shared/types.js'

import styles from './EventPill.module.css'

export type EventPillProps = {
  /** Extra content below the label — the plugin renders per-item resource badges here. */
  children?: React.ReactNode
  compact?: boolean
  label: React.ReactNode
  onSelect: (id: string) => void
  /** Status colours; applied inline so custom statuses are styled identically to built-ins. */
  presentation?: StatusPresentation
  reservation: CalendarReservation
  tooltip?: string
}

/**
 * A single reservation as it appears inside a calendar cell.
 *
 * Colours arrive as props rather than being resolved from a CSS class map, which
 * is what lets a custom status get the same treatment as a built-in one.
 */
export const EventPill: React.FC<EventPillProps> = ({
  children,
  compact,
  label,
  onSelect,
  presentation,
  reservation,
  tooltip,
}) => {
  const activate = (event: React.KeyboardEvent | React.MouseEvent) => {
    event.stopPropagation()
    onSelect(reservation.id)
  }

  return (
    <div
      className={`${styles.eventItem} ${children && !compact ? styles.eventItemExpanded : ''}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate(event)
        }
      }}
      role="button"
      style={
        presentation
          ? { background: presentation.background, color: presentation.foreground }
          : undefined
      }
      tabIndex={0}
      title={tooltip}
    >
      {label}
      {children}
    </div>
  )
}

'use client'
import React from 'react'

import type { StatusPresentation } from '../../../utilities/statusPresentation.js'

import styles from './StatusBadge.module.css'

export type StatusBadgeProps = {
  /** Human-readable status label, already translated. */
  label: string
  /** Colours for this status, from `buildStatusPresentation`. */
  presentation?: StatusPresentation
}

/**
 * A status pill. Colours arrive as props rather than being looked up here, so
 * the same component renders a plugin status machine or a consumer's own
 * vocabulary with no special cases.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, presentation }) => (
  <span
    className={styles.badge}
    style={
      presentation
        ? { background: presentation.background, color: presentation.foreground }
        : undefined
    }
  >
    {label}
  </span>
)

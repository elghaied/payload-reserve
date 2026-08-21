'use client'
import React from 'react'

import styles from './DetailRow.module.css'

export type DetailRowProps = {
  /** Rendered in the value column; use instead of `value` for rich content. */
  children?: React.ReactNode
  label: string
  value?: React.ReactNode
}

/**
 * One label/value line in a detail body. Values share a right edge so a stack of
 * rows scans top-to-bottom in a single line.
 */
export const DetailRow: React.FC<DetailRowProps> = ({ children, label, value }) => (
  <div className={styles.row}>
    <span className={styles.key}>{label}</span>
    <span className={styles.value}>{children ?? value}</span>
  </div>
)

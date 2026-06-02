'use client'
import React from 'react'

import { computeSlotStates } from '../../utilities/computeSlotStates.js'
import styles from './CalendarView.module.css'
import { useResourceAvailability } from './useResourceAvailability.js'

type LaneResource = { id: string; name: string }

const HOUR_START = 7
const HOUR_END = 20

function Lane({
  apiBase,
  day,
  onBook,
  resource,
}: {
  apiBase: string
  day: Date
  onBook: (resourceId: string, startIso: string) => void
  resource: LaneResource
}) {
  const dayStart = new Date(day)
  dayStart.setHours(HOUR_START, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(HOUR_END, 0, 0, 0)

  const { data } = useResourceAvailability(apiBase, resource.id, dayStart, dayEnd)
  const isoDay = day.toISOString().split('T')[0]
  const dayAvail = data?.days.find((d) => d.date === isoDay)

  const slots = dayAvail
    ? computeSlotStates({
        busy: data!.busy,
        capacityMode: data!.capacityMode,
        dayEnd,
        dayStart,
        quantity: data!.quantity,
        shiftWindows: dayAvail.shiftWindows,
        step: 60,
        timeOff: dayAvail.timeOff,
      })
    : []

  return (
    <div className={styles.lane}>
      <div className={styles.laneLabel}>{resource.name}</div>
      <div className={styles.laneTrack}>
        {slots.map((s) => {
          const cls =
            s.state === 'off-shift'
              ? styles.slotOffShift
              : s.state === 'time-off'
                ? styles.slotTimeOff
                : s.state === 'full'
                  ? styles.slotFull
                  : styles.slotFree
          const isFree = s.state === 'free'
          const slotLabel = `${s.start.toLocaleTimeString()} — ${s.state}`
          return isFree ? (
            <div
              aria-label={slotLabel}
              className={`${styles.laneCell} ${cls}`}
              key={s.start.toISOString()}
              onClick={() => onBook(resource.id, s.start.toISOString())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onBook(resource.id, s.start.toISOString())
                }
              }}
              role="button"
              tabIndex={0}
              title={slotLabel}
            />
          ) : (
            <div
              className={`${styles.laneCell} ${cls}`}
              key={s.start.toISOString()}
              title={`${s.start.toLocaleTimeString()} — ${s.state}`}
            />
          )
        })}
      </div>
    </div>
  )
}

export function LaneTimelineView({
  apiBase,
  day,
  onBook,
  resources,
}: {
  apiBase: string
  day: Date
  onBook: (resourceId: string, startIso: string) => void
  resources: LaneResource[]
}) {
  if (resources.length === 0) {
    return <p className={styles.hint}>No active resources to show.</p>
  }
  return (
    <div className={styles.lanes}>
      {resources.map((r) => (
        <Lane apiBase={apiBase} day={day} key={r.id} onBook={onBook} resource={r} />
      ))}
    </div>
  )
}

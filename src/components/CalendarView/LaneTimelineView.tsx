'use client'
import { useTranslation } from '@payloadcms/ui'
import React from 'react'

import type { PluginT } from '../../translations/index.js'
import type { SlotState } from '../../utilities/computeSlotStates.js'

import { computeSlotStates } from '../../utilities/computeSlotStates.js'
import { localDayKey } from '../../utilities/slotUtils.js'
import styles from './CalendarView.module.css'
import { useResourceAvailability } from './useResourceAvailability.js'

type LaneResource = { id: string; name: string }

const HOUR_START = 7
const HOUR_END = 20

const SLOT_STATE_KEYS: Record<SlotState, string> = {
  free: 'reservation:slotFree',
  full: 'reservation:slotFull',
  'off-shift': 'reservation:slotOffShift',
  'time-off': 'reservation:slotTimeOff',
}

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
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const dayStart = new Date(day)
  dayStart.setHours(HOUR_START, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(HOUR_END, 0, 0, 0)

  const { data } = useResourceAvailability(apiBase, resource.id, dayStart, dayEnd)
  const isoDay = localDayKey(day)
  const dayAvail = data?.days.find((d) => d.date === isoDay)

  const slots = dayAvail
    ? computeSlotStates({
        busy: data!.busy,
        capacityMode: data!.capacityMode,
        dayEnd,
        dayStart,
        quantity: data!.quantity,
        requiredPools: data!.requiredPools,
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
          const slotLabel = `${s.start.toLocaleTimeString()} — ${t(SLOT_STATE_KEYS[s.state])}`
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
              title={slotLabel}
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
  const { t: _t } = useTranslation()
  const t = _t as PluginT
  if (resources.length === 0) {
    return <p className={styles.hint}>{t('reservation:laneNoResources')}</p>
  }
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)
  return (
    <div className={styles.lanes}>
      <div className={styles.laneHeader}>
        <div className={styles.laneLabel} />
        <div className={styles.laneTrack}>
          {hours.map((h) => (
            <div className={styles.laneTime} key={h}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
      </div>
      {resources.map((r) => (
        <Lane apiBase={apiBase} day={day} key={r.id} onBook={onBook} resource={r} />
      ))}
    </div>
  )
}

'use client'
import type { AdminViewServerProps } from 'payload'

import { useConfig, useTranslation } from '@payloadcms/ui'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import type { PluginT } from '../../translations/index.js'

import styles from './AvailabilityOverview.module.css'

type Resource = {
  active?: boolean
  capacityMode?: 'per-guest' | 'per-reservation'
  id: string
  name: string
  quantity?: number
}

type Schedule = {
  active?: boolean
  exceptions?: Array<{ date: string; reason?: string }>
  id: string
  manualSlots?: Array<{ date: string; endTime: string; startTime: string }>
  recurringSlots?: Array<{ day: string; endTime: string; startTime: string }>
  resource: { id: string } | string
  scheduleType: 'manual' | 'recurring'
}

type Reservation = {
  endTime?: string
  id: string
  resource: { id: string } | string
  startTime: string
  status: string
}

const DAY_MAP: Record<string, number> = {
  fri: 5,
  mon: 1,
  sat: 6,
  sun: 0,
  thu: 4,
  tue: 2,
  wed: 3,
}

/** Return the CSS class for a capacity badge based on utilization ratio. */
function capacityClass(booked: number, total: number): string {
  if (booked >= total) {return styles.slotCapacityFull}
  if (booked / total >= 0.5) {return styles.slotCapacityMid}
  return styles.slotCapacityLow
}

export const AvailabilityOverview: React.FC<AdminViewServerProps> = () => {
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT
  const slugs = config.admin?.custom?.reservationSlugs
  const statusMachine = config.admin?.custom?.reservationStatusMachine
  const blockingStatuses: string[] = statusMachine?.blockingStatuses ?? ['pending', 'confirmed']

  const DAY_NAMES = useMemo(
    () => [
      t('reservation:dayShortSun'),
      t('reservation:dayShortMon'),
      t('reservation:dayShortTue'),
      t('reservation:dayShortWed'),
      t('reservation:dayShortThu'),
      t('reservation:dayShortFri'),
      t('reservation:dayShortSat'),
    ],
    [t],
  )

  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - d.getDay())
    return d
  })

  const [resources, setResources] = useState<Resource[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    d.setHours(23, 59, 59, 999)
    return d
  }, [weekStart])

  useEffect(() => {
    if (!slugs) {return}

    const fetchData = async () => {
      setLoading(true)
      const apiBase = `${config.serverURL ?? ''}${config.routes.api}`

      // Build a query that fetches only blocking-status reservations so the
      // component doesn't need to filter client-side. The `in` operator on
      // Payload's REST API accepts a comma-separated list.
      const blockingIn = blockingStatuses.join(',')

      try {
        const [resourcesRes, schedulesRes, reservationsRes] = await Promise.all([
          fetch(`${apiBase}/${slugs.resources}?where[active][equals]=true&limit=100`),
          fetch(`${apiBase}/${slugs.schedules}?where[active][equals]=true&limit=500`),
          fetch(
            `${apiBase}/${slugs.reservations}?${new URLSearchParams({
              depth: '0',
              limit: '500',
              'where[startTime][greater_than_equal]': weekStart.toISOString(),
              'where[startTime][less_than_equal]': weekEnd.toISOString(),
              'where[status][in]': blockingIn,
            })}`,
          ),
        ])

        const [rData, sData, resData] = await Promise.all([
          resourcesRes.json(),
          schedulesRes.json(),
          reservationsRes.json(),
        ])

        setResources(rData.docs ?? [])
        setSchedules(sData.docs ?? [])
        setReservations(resData.docs ?? [])
      } catch {
        setResources([])
        setSchedules([])
        setReservations([])
      }
      setLoading(false)
    }

    void fetchData()
    // blockingStatuses is derived from config which is stable; stringify to
    // avoid object-reference churn causing infinite loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekEnd, config.routes.api, config.serverURL, slugs, blockingStatuses.join(',')])

  const navigateWeek = useCallback((direction: -1 | 1) => {
    setWeekStart((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + 7 * direction)
      return next
    })
  }, [])

  const goToThisWeek = useCallback(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - d.getDay())
    setWeekStart(d)
  }, [])

  const getResourceId = (r: { id: string } | string) =>
    typeof r === 'object' ? r.id : r

  const getSlotsForResourceDay = (resourceId: string, day: Date) => {
    const resourceSchedules = schedules.filter(
      (s) => getResourceId(s.resource) === resourceId,
    )
    const dateStr = day.toISOString().split('T')[0]
    const dayOfWeek = day.getDay()

    const slots: Array<{ label: string; type: 'available' | 'exception' }> = []

    for (const schedule of resourceSchedules) {
      // Check for exceptions
      const exception = schedule.exceptions?.find((e) => {
        const excDate = new Date(e.date).toISOString().split('T')[0]
        return excDate === dateStr
      })

      if (exception) {
        slots.push({
          type: 'exception',
          label: exception.reason || t('reservation:availabilityUnavailable'),
        })
        continue
      }

      if (schedule.scheduleType === 'recurring') {
        for (const slot of schedule.recurringSlots ?? []) {
          if (DAY_MAP[slot.day] === dayOfWeek) {
            slots.push({
              type: 'available',
              label: `${slot.startTime}-${slot.endTime}`,
            })
          }
        }
      } else if (schedule.scheduleType === 'manual') {
        for (const slot of schedule.manualSlots ?? []) {
          const slotDate = new Date(slot.date).toISOString().split('T')[0]
          if (slotDate === dateStr) {
            slots.push({
              type: 'available',
              label: `${slot.startTime}-${slot.endTime}`,
            })
          }
        }
      }
    }

    return slots
  }

  /** Returns all blocking-status reservations for a resource on a given day. */
  const getBookingsForResourceDay = (resourceId: string, day: Date) => {
    return reservations.filter((r) => {
      const rDate = new Date(r.startTime)
      return (
        getResourceId(r.resource) === resourceId &&
        rDate.getFullYear() === day.getFullYear() &&
        rDate.getMonth() === day.getMonth() &&
        rDate.getDate() === day.getDate()
      )
    })
  }

  if (!slugs) {
    return <div className={styles.noResources}>{t('reservation:availabilityNotConfigured')}</div>
  }

  if (loading) {
    return <div className={styles.loading}>{t('reservation:availabilityLoading')}</div>
  }

  const weekLabel = `${weekDays[0].toLocaleDateString([], { day: 'numeric', month: 'short' })} - ${weekDays[6].toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`

  const gridColumns = `150px repeat(7, 1fr)`

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>{t('reservation:availabilityTitle')}</h2>
      <div className={styles.navigation}>
        <button className={styles.navButton} onClick={() => navigateWeek(-1)} type="button">
          &larr;
        </button>
        <button className={styles.navButton} onClick={goToThisWeek} type="button">
          {t('reservation:availabilityThisWeek')}
        </button>
        <button className={styles.navButton} onClick={() => navigateWeek(1)} type="button">
          &rarr;
        </button>
        <span className={styles.weekLabel}>{weekLabel}</span>
      </div>

      {resources.length === 0 ? (
        <div className={styles.noResources}>{t('reservation:availabilityNoResources')}</div>
      ) : (
        <div className={styles.grid} style={{ gridTemplateColumns: gridColumns }}>
          {/* Header row */}
          <div className={styles.headerCell}>{t('reservation:availabilityResource')}</div>
          {weekDays.map((day, i) => (
            <div className={styles.headerCell} key={i}>
              {DAY_NAMES[day.getDay()]} {day.getDate()}
            </div>
          ))}

          {/* Resource rows */}
          {resources.map((resource) => {
            const quantity = resource.quantity ?? 1
            return (
              <Fragment key={resource.id}>
                <div className={styles.resourceName}>
                  {resource.name}
                  {quantity > 1 && (
                    <span style={{ fontWeight: 400, marginLeft: 4, opacity: 0.6 }}>
                      {' '}(&times;{quantity})
                    </span>
                  )}
                </div>
                {weekDays.map((day, di) => {
                  const slots = getSlotsForResourceDay(resource.id, day)
                  const bookings = getBookingsForResourceDay(resource.id, day)
                  const bookedCount = bookings.length

                  return (
                    <div className={styles.cell} key={`cell-${resource.id}-${di}`}>
                      {slots.map((slot, si) => (
                        <div
                          className={
                            slot.type === 'exception'
                              ? styles.slotException
                              : styles.slotAvailable
                          }
                          key={`slot-${si}`}
                        >
                          {slot.label}
                        </div>
                      ))}
                      {quantity > 1 ? (
                        /* Multi-unit resource: show X/Y booked with graduated color */
                        bookedCount > 0 && (
                          <div
                            className={capacityClass(bookedCount, quantity)}
                            title={t('reservation:availabilityXofYBooked', {
                              booked: bookedCount,
                              total: quantity,
                            })}
                          >
                            {t('reservation:availabilityXofYBooked', {
                              booked: bookedCount,
                              total: quantity,
                            })}
                          </div>
                        )
                      ) : (
                        /* Single-unit resource: show individual booking times */
                        bookings.map((b) => (
                          <div className={styles.slotBooked} key={b.id}>
                            {new Date(b.startTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            {t('reservation:availabilityBooked')}
                          </div>
                        ))
                      )}
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

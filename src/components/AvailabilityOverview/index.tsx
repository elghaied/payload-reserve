'use client'
import type { AdminViewServerProps } from 'payload'

import { useConfig } from '@payloadcms/ui'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import styles from './AvailabilityOverview.module.css'

type Resource = {
  active?: boolean
  id: string
  name: string
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MAP: Record<string, number> = {
  fri: 5,
  mon: 1,
  sat: 6,
  sun: 0,
  thu: 4,
  tue: 2,
  wed: 3,
}

export const AvailabilityOverview: React.FC<AdminViewServerProps> = () => {
  const { config } = useConfig()
  const slugs = config.admin?.custom?.reservationSlugs

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
              'where[status][not_in]': 'cancelled,no-show',
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
  }, [weekStart, weekEnd, config.routes.api, config.serverURL, slugs])

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
          label: exception.reason || 'Unavailable',
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
    return <div className={styles.noResources}>Reservation plugin not configured.</div>
  }

  if (loading) {
    return <div className={styles.loading}>Loading availability...</div>
  }

  const weekLabel = `${weekDays[0].toLocaleDateString([], { day: 'numeric', month: 'short' })} - ${weekDays[6].toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`

  const gridColumns = `150px repeat(7, 1fr)`

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>Availability Overview</h2>
      <div className={styles.navigation}>
        <button className={styles.navButton} onClick={() => navigateWeek(-1)} type="button">
          &larr;
        </button>
        <button className={styles.navButton} onClick={goToThisWeek} type="button">
          This Week
        </button>
        <button className={styles.navButton} onClick={() => navigateWeek(1)} type="button">
          &rarr;
        </button>
        <span className={styles.weekLabel}>{weekLabel}</span>
      </div>

      {resources.length === 0 ? (
        <div className={styles.noResources}>No active resources found.</div>
      ) : (
        <div className={styles.grid} style={{ gridTemplateColumns: gridColumns }}>
          {/* Header row */}
          <div className={styles.headerCell}>Resource</div>
          {weekDays.map((day, i) => (
            <div className={styles.headerCell} key={i}>
              {DAY_NAMES[day.getDay()]} {day.getDate()}
            </div>
          ))}

          {/* Resource rows */}
          {resources.map((resource) => (
            <Fragment key={resource.id}>
              <div className={styles.resourceName}>
                {resource.name}
              </div>
              {weekDays.map((day, di) => {
                const slots = getSlotsForResourceDay(resource.id, day)
                const bookings = getBookingsForResourceDay(resource.id, day)

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
                    {bookings.map((b) => (
                      <div className={styles.slotBooked} key={b.id}>
                        {new Date(b.startTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        Booked
                      </div>
                    ))}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'
import type { AdminViewServerProps } from 'payload'

import { useConfig, useDocumentDrawer } from '@payloadcms/ui'
import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

import styles from './CalendarView.module.css'

type ViewMode = 'day' | 'month' | 'week'

type Reservation = {
  customer?: { name?: string } | string
  endTime?: string
  id: string
  resource?: { name?: string } | string
  service?: { name?: string } | string
  startTime: string
  status: string
}

const STATUS_CLASS_MAP: Record<string, string> = {
  cancelled: styles.statusCancelled,
  completed: styles.statusCompleted,
  confirmed: styles.statusConfirmed,
  'no-show': styles.statusNoShow,
  pending: styles.statusPending,
}

const STATUS_COLORS: Record<string, string> = {
  cancelled: '#e5e7eb',
  completed: '#d1fae5',
  confirmed: '#dbeafe',
  'no-show': '#fee2e2',
  pending: '#fef3c7',
}

const STATUS_LABELS: Record<string, string> = {
  cancelled: 'Cancelled',
  completed: 'Completed',
  confirmed: 'Confirmed',
  'no-show': 'No-show',
  pending: 'Pending',
}

export const CalendarView: React.FC<AdminViewServerProps> = () => {
  const { config } = useConfig()
  const slugs = config.admin?.custom?.reservationSlugs
  const reservationSlug = slugs?.reservations ?? 'reservations'

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerDocId, setDrawerDocId] = useState<null | string>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown> | undefined>(undefined)

  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    id: drawerDocId ?? undefined,
    collectionSlug: reservationSlug,
  })

  const { rangeEnd, rangeStart } = useMemo(() => {
    const start = new Date(currentDate)
    const end = new Date(currentDate)

    if (viewMode === 'month') {
      start.setDate(1)
      start.setDate(start.getDate() - start.getDay())
      end.setMonth(end.getMonth() + 1, 0)
      end.setDate(end.getDate() + (6 - end.getDay()))
    } else if (viewMode === 'week') {
      const dayOfWeek = start.getDay()
      start.setDate(start.getDate() - dayOfWeek)
      end.setDate(start.getDate() + 6)
    }
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)

    return { rangeEnd: end, rangeStart: start }
  }, [currentDate, viewMode])

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    try {
      const apiUrl = `${config.serverURL ?? ''}${config.routes.api}/${reservationSlug}`
      const params = new URLSearchParams({
        depth: '1',
        limit: '500',
        sort: 'startTime',
        'where[startTime][greater_than_equal]': rangeStart.toISOString(),
        'where[startTime][less_than_equal]': rangeEnd.toISOString(),
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      setReservations(result.docs ?? [])
    } catch {
      setReservations([])
    }
    setLoading(false)
  }, [rangeStart, rangeEnd, config.routes.api, config.serverURL, reservationSlug])

  useEffect(() => {
    void fetchReservations()
  }, [fetchReservations])

  const handleEventClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      setDrawerDocId(id)
      setInitialData(undefined)
      openDrawer()
    },
    [openDrawer],
  )

  const handleEventKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        setDrawerDocId(id)
        setInitialData(undefined)
        openDrawer()
      }
    },
    [openDrawer],
  )

  const handleCreateNew = useCallback(() => {
    setDrawerDocId(null)
    setInitialData(undefined)
    openDrawer()
  }, [openDrawer])

  const handleDateClick = useCallback(
    (date: Date) => {
      setDrawerDocId(null)
      setInitialData({ startTime: date.toISOString() })
      openDrawer()
    },
    [openDrawer],
  )

  const navigate = useCallback(
    (direction: -1 | 1) => {
      setCurrentDate((prev) => {
        const next = new Date(prev)
        if (viewMode === 'month') {
          next.setMonth(next.getMonth() + direction)
        } else if (viewMode === 'week') {
          next.setDate(next.getDate() + 7 * direction)
        } else {
          next.setDate(next.getDate() + direction)
        }
        return next
      })
    },
    [viewMode],
  )

  const goToToday = useCallback(() => setCurrentDate(new Date()), [])

  const getResName = (field: { name?: string } | string | undefined): string => {
    if (!field) return ''
    if (typeof field === 'string') return ''
    return field.name ?? ''
  }

  const getEventLabel = (r: Reservation, compact: boolean) => {
    const time = new Date(r.startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    const serviceName = getResName(r.service)
    if (compact) {
      return `${time} ${serviceName}`.trim()
    }
    const customerName = getResName(r.customer)
    const parts = [time, serviceName, customerName].filter(Boolean)
    return parts.join(' - ')
  }

  const getEventTooltip = (r: Reservation): string => {
    const serviceName = getResName(r.service) || 'Unknown service'
    const startStr = new Date(r.startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    const endStr = r.endTime
      ? new Date(r.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '?'
    const customerName = getResName(r.customer) || 'Unknown customer'
    const resourceName = getResName(r.resource) || 'Unknown resource'
    const status = STATUS_LABELS[r.status] ?? r.status
    return `${serviceName}\n${startStr} - ${endStr}\nCustomer: ${customerName}\nResource: ${resourceName}\nStatus: ${status}`
  }

  const renderEventItem = (r: Reservation, compact: boolean) => (
    <div
      className={`${styles.eventItem} ${STATUS_CLASS_MAP[r.status] ?? ''}`}
      key={r.id}
      onClick={(e) => handleEventClick(e, r.id)}
      onKeyDown={(e) => handleEventKeyDown(e, r.id)}
      role="button"
      tabIndex={0}
      title={getEventTooltip(r)}
    >
      {getEventLabel(r, compact)}
    </div>
  )

  const renderStatusLegend = () => (
    <div className={styles.statusLegend}>
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <div className={styles.legendItem} key={key}>
          <span className={styles.legendDot} style={{ background: STATUS_COLORS[key] }} />
          {label}
        </div>
      ))}
    </div>
  )

  const renderCurrentTimeLine = (cellDate: Date, cellHour: number) => {
    const now = new Date()
    if (
      now.getFullYear() !== cellDate.getFullYear() ||
      now.getMonth() !== cellDate.getMonth() ||
      now.getDate() !== cellDate.getDate() ||
      now.getHours() !== cellHour
    ) {
      return null
    }
    const topPercent = (now.getMinutes() / 60) * 100
    return <div className={styles.currentTimeLine} style={{ top: `${topPercent}%` }} />
  }

  const renderMonthView = () => {
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const startDay = new Date(firstDay)
    startDay.setDate(startDay.getDate() - startDay.getDay())

    const days: Date[] = []
    const d = new Date(startDay)
    for (let i = 0; i < 42; i++) {
      days.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`

    return (
      <div className={styles.monthGrid}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div className={styles.dayHeader} key={d}>
            {d}
          </div>
        ))}
        {days.map((day, i) => {
          const dayStr = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          const isToday = dayStr === todayStr
          const isOtherMonth = day.getMonth() !== currentDate.getMonth()
          const dayReservations = reservations.filter((r) => {
            const rDate = new Date(r.startTime)
            return (
              rDate.getFullYear() === day.getFullYear() &&
              rDate.getMonth() === day.getMonth() &&
              rDate.getDate() === day.getDate()
            )
          })

          const clickDate = new Date(day)
          clickDate.setHours(9, 0, 0, 0)

          return (
            <div
              className={`${styles.dayCell} ${isOtherMonth ? styles.dayCellOtherMonth : ''} ${isToday ? styles.dayCellToday : ''}`}
              key={i}
              onClick={() => handleDateClick(clickDate)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleDateClick(clickDate)
                }
              }}
            >
              <div className={styles.dayNumber}>{day.getDate()}</div>
              {dayReservations.map((r) => renderEventItem(r, true))}
            </div>
          )
        })}
      </div>
    )
  }

  const renderWeekView = () => {
    const startOfWeek = new Date(currentDate)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
    startOfWeek.setHours(0, 0, 0, 0)

    const weekDays: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek)
      d.setDate(d.getDate() + i)
      weekDays.push(d)
    }

    const hours = Array.from({ length: 12 }, (_, i) => i + 7)

    return (
      <div className={styles.weekView}>
        <div className={styles.dayHeader} />
        {weekDays.map((d, i) => (
          <div className={styles.dayHeader} key={i}>
            {d.toLocaleDateString([], { day: 'numeric', month: 'numeric', weekday: 'short' })}
          </div>
        ))}
        {hours.map((hour) => (
          <Fragment key={`row-${hour}`}>
            <div className={styles.timeLabel}>
              {hour.toString().padStart(2, '0')}:00
            </div>
            {weekDays.map((day, di) => {
              const cellReservations = reservations.filter((r) => {
                const rDate = new Date(r.startTime)
                return (
                  rDate.getFullYear() === day.getFullYear() &&
                  rDate.getMonth() === day.getMonth() &&
                  rDate.getDate() === day.getDate() &&
                  rDate.getHours() === hour
                )
              })
              const clickDate = new Date(day)
              clickDate.setHours(hour, 0, 0, 0)
              return (
                <div
                  className={styles.weekCell}
                  key={`cell-${hour}-${di}`}
                  onClick={() => handleDateClick(clickDate)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleDateClick(clickDate)
                    }
                  }}
                >
                  {renderCurrentTimeLine(day, hour)}
                  {cellReservations.map((r) => renderEventItem(r, false))}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    )
  }

  const renderDayView = () => {
    const hours = Array.from({ length: 14 }, (_, i) => i + 7)

    return (
      <div className={styles.dayView}>
        {hours.map((hour) => {
          const hourReservations = reservations.filter((r) => {
            const rDate = new Date(r.startTime)
            return (
              rDate.getFullYear() === currentDate.getFullYear() &&
              rDate.getMonth() === currentDate.getMonth() &&
              rDate.getDate() === currentDate.getDate() &&
              rDate.getHours() === hour
            )
          })
          const clickDate = new Date(currentDate)
          clickDate.setHours(hour, 0, 0, 0)
          return (
            <Fragment key={`row-${hour}`}>
              <div className={styles.timeLabel}>
                {hour.toString().padStart(2, '0')}:00
              </div>
              <div
                className={styles.dayViewCell}
                onClick={() => handleDateClick(clickDate)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleDateClick(clickDate)
                  }
                }}
              >
                {renderCurrentTimeLine(currentDate, hour)}
                {hourReservations.map((r) => renderEventItem(r, false))}
              </div>
            </Fragment>
          )
        })}
      </div>
    )
  }

  const dateLabel = useMemo(() => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
    }
    if (viewMode === 'week') {
      const startOfWeek = new Date(currentDate)
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(endOfWeek.getDate() + 6)
      return `${startOfWeek.toLocaleDateString([], { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return currentDate.toLocaleDateString([], {
      day: 'numeric',
      month: 'long',
      weekday: 'long',
      year: 'numeric',
    })
  }, [currentDate, viewMode])

  if (loading) {
    return <div className={styles.loading}>Loading reservations...</div>
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.navButtons}>
          <button className={styles.navButton} onClick={() => navigate(-1)} type="button">
            &larr;
          </button>
          <button className={styles.navButton} onClick={goToToday} type="button">
            Today
          </button>
          <button className={styles.navButton} onClick={() => navigate(1)} type="button">
            &rarr;
          </button>
          <span className={styles.currentDate}>{dateLabel}</span>
        </div>
        <div className={styles.viewToggle}>
          <button className={styles.createButton} onClick={handleCreateNew} type="button">
            Create New
          </button>
          {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
            <button
              className={`${styles.viewToggleButton} ${viewMode === mode ? styles.viewToggleButtonActive : ''}`}
              key={mode}
              onClick={() => setViewMode(mode)}
              type="button"
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {renderStatusLegend()}
      {viewMode === 'month' && renderMonthView()}
      {viewMode === 'week' && renderWeekView()}
      {viewMode === 'day' && renderDayView()}
      <DocumentDrawer initialData={initialData} onSave={fetchReservations} />
    </div>
  )
}

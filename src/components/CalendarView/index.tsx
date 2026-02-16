'use client'
import type { AdminViewServerProps } from 'payload'

import { useConfig, useDocumentDrawer, useTranslation } from '@payloadcms/ui'
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PluginT } from '../../translations/index.js'

import styles from './CalendarView.module.css'

type ViewMode = 'day' | 'month' | 'pending' | 'week'

type Reservation = {
  customer?: { firstName?: string; lastName?: string; name?: string } | string
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

export const CalendarView: React.FC<AdminViewServerProps> = () => {
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const STATUS_LABELS = useMemo<Record<string, string>>(
    () => ({
      cancelled: t('reservation:statusCancelled'),
      completed: t('reservation:statusCompleted'),
      confirmed: t('reservation:statusConfirmed'),
      'no-show': t('reservation:statusNoShowLabel'),
      pending: t('reservation:statusPending'),
    }),
    [t],
  )
  const slugs = config.admin?.custom?.reservationSlugs
  const reservationSlug = slugs?.reservations ?? 'reservations'
  const apiUrl = `${config.serverURL ?? ''}${config.routes.api}/${reservationSlug}`

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerDocId, setDrawerDocId] = useState<null | string>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown> | undefined>(undefined)

  // Pending tab state
  const [pendingReservations, setPendingReservations] = useState<Reservation[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(() => new Set())
  const [actionFeedback, setActionFeedback] = useState<{
    message: string
    type: 'error' | 'success'
  } | null>(null)

  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    id: drawerDocId ?? undefined,
    collectionSlug: reservationSlug,
  })

  const pendingDrawerOpen = useRef(false)

  useEffect(() => {
    if (pendingDrawerOpen.current) {
      pendingDrawerOpen.current = false
      openDrawer()
    }
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
  }, [rangeStart, rangeEnd, apiUrl])

  useEffect(() => {
    void fetchReservations()
  }, [fetchReservations])

  // Fetch pending count (always, for badge)
  const fetchPendingCount = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: '0',
        'where[status][equals]': 'pending',
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      setPendingCount(result.totalDocs ?? 0)
    } catch {
      // silently ignore
    }
  }, [apiUrl])

  useEffect(() => {
    void fetchPendingCount()
  }, [fetchPendingCount])

  // Fetch pending reservations when tab is active
  const fetchPendingReservations = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        depth: '1',
        limit: '500',
        sort: 'startTime',
        'where[status][equals]': 'pending',
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      setPendingReservations(result.docs ?? [])
    } catch {
      setPendingReservations([])
    }
  }, [apiUrl])

  useEffect(() => {
    if (viewMode === 'pending') {
      void fetchPendingReservations()
    }
  }, [viewMode, fetchPendingReservations])

  // Clear selection when leaving pending view
  useEffect(() => {
    if (viewMode !== 'pending') {
      setSelectedIds(new Set())
      setActionFeedback(null)
    }
  }, [viewMode])

  // Auto-clear feedback toast
  useEffect(() => {
    if (!actionFeedback) {return}
    const timer = setTimeout(() => setActionFeedback(null), 4000)
    return () => clearTimeout(timer)
  }, [actionFeedback])

  const patchReservation = useCallback(
    async (id: string, data: Record<string, unknown>): Promise<boolean> => {
      try {
        const response = await fetch(`${apiUrl}/${id}`, {
          body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        })
        return response.ok
      } catch {
        return false
      }
    },
    [apiUrl],
  )

  const handleQuickConfirm = useCallback(
    async (id: string) => {
      setConfirmingIds((prev) => new Set(prev).add(id))
      const ok = await patchReservation(id, { status: 'confirmed' })
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setActionFeedback({
        type: ok ? 'success' : 'error',
        message: ok
          ? t('reservation:pendingConfirmSuccess')
          : t('reservation:pendingConfirmError'),
      })
      if (ok) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        void fetchPendingReservations()
        void fetchPendingCount()
      }
    },
    [patchReservation, fetchPendingReservations, fetchPendingCount, t],
  )

  const handleQuickCancel = useCallback(
    async (id: string) => {
      setConfirmingIds((prev) => new Set(prev).add(id))
      const ok = await patchReservation(id, { status: 'cancelled' })
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setActionFeedback({
        type: ok ? 'success' : 'error',
        message: ok
          ? t('reservation:pendingCancelSuccess')
          : t('reservation:pendingCancelError'),
      })
      if (ok) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        void fetchPendingReservations()
        void fetchPendingCount()
      }
    },
    [patchReservation, fetchPendingReservations, fetchPendingCount, t],
  )

  const confirmSelected = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {return}

    setConfirmingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {next.add(id)}
      return next
    })

    const results = await Promise.allSettled(
      ids.map((id) => patchReservation(id, { status: 'confirmed' })),
    )

    setConfirmingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {next.delete(id)}
      return next
    })

    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && r.value,
    ).length
    const failed = ids.length - succeeded

    if (failed === 0) {
      setActionFeedback({
        type: 'success',
        message: `${succeeded} ${t('reservation:pendingConfirmSuccess').toLowerCase()}`,
      })
    } else {
      setActionFeedback({
        type: failed === ids.length ? 'error' : 'success',
        message: t('reservation:pendingBulkConfirmSuccess')
          .replace('{{succeeded}}', String(succeeded))
          .replace('{{failed}}', String(failed)),
      })
    }

    setSelectedIds(new Set())
    void fetchPendingReservations()
    void fetchPendingCount()
  }, [selectedIds, patchReservation, fetchPendingReservations, fetchPendingCount, t])

  const handleEventClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDrawerDocId(id)
    setInitialData(undefined)
    pendingDrawerOpen.current = true
  }, [])

  const handleEventKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      setDrawerDocId(id)
      setInitialData(undefined)
      pendingDrawerOpen.current = true
    }
  }, [])

  const handleCreateNew = useCallback(() => {
    setDrawerDocId(null)
    setInitialData(undefined)
    pendingDrawerOpen.current = true
  }, [])

  const handleDateClick = useCallback((date: Date) => {
    setDrawerDocId(null)
    setInitialData({ startTime: date.toISOString() })
    pendingDrawerOpen.current = true
  }, [])

  const openDocDrawer = useCallback((id: string) => {
    setDrawerDocId(id)
    setInitialData(undefined)
    pendingDrawerOpen.current = true
  }, [])

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
    if (!field) {return ''}
    if (typeof field === 'string') {return ''}
    return field.name ?? ''
  }

  const getCustomerName = (field: Reservation['customer']): string => {
    if (!field) {return ''}
    if (typeof field === 'string') {return ''}
    const parts = [field.firstName, field.lastName].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : (field.name ?? '')
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
    const customerName = getCustomerName(r.customer)
    const parts = [time, serviceName, customerName].filter(Boolean)
    return parts.join(' - ')
  }

  const getEventTooltip = (r: Reservation): string => {
    const serviceName = getResName(r.service) || t('reservation:calendarUnknownService')
    const startStr = new Date(r.startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    const endStr = r.endTime
      ? new Date(r.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '?'
    const customerName = getCustomerName(r.customer) || t('reservation:calendarUnknownCustomer')
    const resourceName = getResName(r.resource) || t('reservation:calendarUnknownResource')
    const status = STATUS_LABELS[r.status] ?? r.status
    return `${serviceName}\n${startStr} - ${endStr}\n${t('reservation:tooltipCustomer')} ${customerName}\n${t('reservation:tooltipResource')} ${resourceName}\n${t('reservation:tooltipStatus')} ${status}`
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
        {[
          t('reservation:dayShortSun'),
          t('reservation:dayShortMon'),
          t('reservation:dayShortTue'),
          t('reservation:dayShortWed'),
          t('reservation:dayShortThu'),
          t('reservation:dayShortFri'),
          t('reservation:dayShortSat'),
        ].map((d) => (
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleDateClick(clickDate)
                }
              }}
              role="button"
              tabIndex={0}
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleDateClick(clickDate)
                    }
                  }}
                  role="button"
                  tabIndex={0}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleDateClick(clickDate)
                  }
                }}
                role="button"
                tabIndex={0}
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

  const renderPendingView = () => {
    if (pendingReservations.length === 0) {
      return <div className={styles.pendingEmpty}>{t('reservation:pendingEmpty')}</div>
    }

    const allSelected =
      pendingReservations.length > 0 &&
      pendingReservations.every((r) => selectedIds.has(r.id))

    const toggleSelectAll = () => {
      if (allSelected) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(pendingReservations.map((r) => r.id)))
      }
    }

    const toggleSelect = (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    }

    const formatDateTime = (iso: string) => {
      const d = new Date(iso)
      return d.toLocaleString([], {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }

    return (
      <div className={styles.pendingView}>
        <div className={styles.pendingToolbar}>
          <label className={styles.selectAllLabel}>
            <input
              aria-label={t('reservation:pendingSelectAll')}
              checked={allSelected}
              onChange={toggleSelectAll}
              type="checkbox"
            />
            {t('reservation:pendingSelectAll')}
          </label>
          {selectedIds.size > 0 && (
            <button
              className={styles.bulkConfirmButton}
              disabled={confirmingIds.size > 0}
              onClick={() => void confirmSelected()}
              type="button"
            >
              {confirmingIds.size > 0
                ? t('reservation:pendingConfirming')
                : t('reservation:pendingConfirmSelected').replace(
                    '{{count}}',
                    String(selectedIds.size),
                  )}
            </button>
          )}
        </div>
        {actionFeedback && (
          <div
            className={`${styles.feedbackToast} ${actionFeedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError}`}
          >
            {actionFeedback.message}
          </div>
        )}
        <table className={styles.pendingTable}>
          <thead>
            <tr>
              <th aria-label={t('reservation:pendingSelectAll')} className={styles.pendingTh} />
              <th className={styles.pendingTh}>{t('reservation:fieldCustomer')}</th>
              <th className={styles.pendingTh}>{t('reservation:fieldService')}</th>
              <th className={styles.pendingTh}>{t('reservation:fieldResource')}</th>
              <th className={styles.pendingTh}>{t('reservation:pendingDateTime')}</th>
              <th className={styles.pendingTh}>{t('reservation:pendingActions')}</th>
            </tr>
          </thead>
          <tbody>
            {pendingReservations.map((r) => {
              const isConfirming = confirmingIds.has(r.id)
              return (
                <tr className={styles.pendingRow} key={r.id}>
                  <td className={styles.pendingTd}>
                    <input
                      aria-label={getCustomerName(r.customer) || r.id}
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      type="checkbox"
                    />
                  </td>
                  <td className={styles.pendingTd}>
                    <span
                      className={styles.pendingCustomerLink}
                      onClick={() => openDocDrawer(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openDocDrawer(r.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {getCustomerName(r.customer) || t('reservation:calendarUnknownCustomer')}
                    </span>
                  </td>
                  <td className={styles.pendingTd}>
                    {getResName(r.service) || t('reservation:calendarUnknownService')}
                  </td>
                  <td className={styles.pendingTd}>
                    {getResName(r.resource) || t('reservation:calendarUnknownResource')}
                  </td>
                  <td className={styles.pendingTd}>{formatDateTime(r.startTime)}</td>
                  <td className={styles.pendingTd}>
                    <button
                      className={styles.confirmButton}
                      disabled={isConfirming}
                      onClick={() => void handleQuickConfirm(r.id)}
                      title={t('reservation:pendingConfirm')}
                      type="button"
                    >
                      &#x2713;
                    </button>
                    <button
                      className={styles.cancelButton}
                      disabled={isConfirming}
                      onClick={() => void handleQuickCancel(r.id)}
                      title={t('reservation:pendingCancel')}
                      type="button"
                    >
                      &#x2717;
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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

  const handleDrawerSave = useCallback(() => {
    void fetchReservations()
    void fetchPendingCount()
    if (viewMode === 'pending') {
      void fetchPendingReservations()
    }
  }, [fetchReservations, fetchPendingCount, fetchPendingReservations, viewMode])

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        {viewMode !== 'pending' && (
          <div className={styles.navButtons}>
            <button className={styles.navButton} onClick={() => navigate(-1)} type="button">
              &larr;
            </button>
            <button className={styles.navButton} onClick={goToToday} type="button">
              {t('reservation:calendarToday')}
            </button>
            <button className={styles.navButton} onClick={() => navigate(1)} type="button">
              &rarr;
            </button>
            <span className={styles.currentDate}>{dateLabel}</span>
          </div>
        )}
        {viewMode === 'pending' && <div />}
        <div className={styles.viewToggle}>
          <button className={styles.createButton} onClick={handleCreateNew} type="button">
            {t('reservation:calendarCreateNew')}
          </button>
          {([
            { key: 'month' as ViewMode, label: t('reservation:calendarMonth') },
            { key: 'week' as ViewMode, label: t('reservation:calendarWeek') },
            { key: 'day' as ViewMode, label: t('reservation:calendarDay') },
            { key: 'pending' as ViewMode, label: t('reservation:calendarPending') },
          ]).map(({ key, label }) => (
            <button
              className={`${styles.viewToggleButton} ${viewMode === key ? styles.viewToggleButtonActive : ''}`}
              key={key}
              onClick={() => setViewMode(key)}
              type="button"
            >
              {label}
              {key === 'pending' && pendingCount > 0 && (
                <span className={styles.pendingBadge}>{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      {viewMode !== 'pending' && renderStatusLegend()}
      {loading && viewMode !== 'pending' ? (
        <div className={styles.loading}>{t('reservation:calendarLoading')}</div>
      ) : (
        <>
          {viewMode === 'month' && renderMonthView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'day' && renderDayView()}
        </>
      )}
      {viewMode === 'pending' && renderPendingView()}
      <DocumentDrawer initialData={initialData} onSave={handleDrawerSave} />
    </div>
  )
}

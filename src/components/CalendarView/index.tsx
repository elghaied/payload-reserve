'use client'
import type { AdminViewServerProps } from 'payload'

import { useConfig, useDocumentDrawer, useTranslation } from '@payloadcms/ui'
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PluginT } from '../../translations/index.js'
import type { SlotInfo } from '../../utilities/computeSlotStates.js'
import type { Reservation, ResourceOption } from '../shared/types.js'

import {
  dayKeySequence,
  displayDateForDayKey,
  gridInstant,
  instantAtHour,
  monthGridStartDayKey,
  startOfWeekDayKey,
} from '../../utilities/calendarGrid.js'
import { computeSlotStates } from '../../utilities/computeSlotStates.js'
import { externalPillLabel } from '../../utilities/externalPillLabel.js'
import { reservationMatchesResource, sameId } from '../../utilities/reservationResourceFilter.js'
import {
  addDaysToDayKey,
  getDayKeyInTimezone,
  getHourInTimezone,
} from '../../utilities/timezoneUtils.js'
import { useTenantFilter } from '../../utilities/useTenantFilter.js'
import { useReservationMutations } from '../hooks/useReservationMutations.js'
import { useReservationStatusMachine } from '../hooks/useReservationStatusMachine.js'
import eventPillStyles from '../primitives/EventPill/EventPill.module.css'
import { EventPill } from '../primitives/EventPill/index.js'
import styles from './CalendarView.module.css'
import { LaneTimelineView } from './LaneTimelineView.js'
import { useResourceAvailability } from './useResourceAvailability.js'

type ViewMode = 'day' | 'lanes' | 'month' | 'pending' | 'week'

// Safe ceiling for list fetches; when totalDocs exceeds this we surface a
// "showing N of M" notice rather than silently truncating (review D9).
const MAX_LIST_LIMIT = 2000

// Default visible-hour window for the week/day/lane grids; the actual window
// expands to include any booking outside it so nothing is hidden (review D8).
const DEFAULT_HOUR_START = 7
const DEFAULT_HOUR_END = 20

/**
 * Visible-hour window covering `reservations` (in `timeZone`), never narrower
 * than the default business window. Every booking's start hour gets a row, so a
 * booking outside 7–20 is shown rather than silently dropped, and all three
 * time views share one window.
 */
function computeHourWindow(
  reservations: Reservation[],
  timeZone: string,
): { endHour: number; startHour: number } {
  let startHour = DEFAULT_HOUR_START
  let endHour = DEFAULT_HOUR_END
  for (const r of reservations) {
    if (!r.startTime) {continue}
    const sh = getHourInTimezone(new Date(r.startTime), timeZone)
    startHour = Math.min(startHour, sh)
    endHour = Math.max(endHour, sh + 1)
    if (r.endTime) {
      // round the ending hour up so a slot that ends mid-hour still has a row
      endHour = Math.max(endHour, getHourInTimezone(new Date(r.endTime), timeZone) + 1)
    }
  }
  return { endHour: Math.min(endHour, 24), startHour: Math.max(startHour, 0) }
}

export const CalendarView: React.FC<AdminViewServerProps> = () => {
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const slugs = config.admin?.custom?.reservationSlugs
  const reservationSlug = slugs?.reservations ?? 'reservations'
  const apiUrl = `${config.serverURL ?? ''}${config.routes.api}/${reservationSlug}`
  const apiBase = `${config.serverURL ?? ''}${config.routes.api}`
  const resourceSlug = slugs?.resources ?? 'resources'
  const reservationTenantParams = useTenantFilter(reservationSlug)
  const resourceTenantParams = useTenantFilter(resourceSlug)
  const { cancel: cancelReservation, transition: transitionReservation } = useReservationMutations()

  // Day-boundary rendering uses the business timezone. In multiTenant mode that's
  // the SELECTED tenant's zone, resolved server-side from the tenant cookie (the
  // client can't map tenant→zone itself). Until that resolves — and for plain
  // installs — fall back to the static global zone baked into admin config.
  const staticReservationTimezone =
    ((config.admin?.custom as Record<string, unknown> | undefined)?.reservationTimezone as
      | string
      | undefined) ?? 'UTC'
  const [effectiveTimezone, setEffectiveTimezone] = useState<null | string>(null)
  const reservationTimezone = effectiveTimezone ?? staticReservationTimezone

  const tenantKey = JSON.stringify(reservationTenantParams)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/reserve/effective-timezone`, {
          credentials: 'same-origin',
        })
        if (!res.ok) {
          return
        }
        const json = await res.json()
        if (!cancelled && typeof json?.timeZone === 'string') {
          setEffectiveTimezone(json.timeZone)
        }
      } catch {
        // keep the static fallback
      }
    })()
    return () => {
      cancelled = true
    }
     
  }, [apiBase, tenantKey])

  const statusMachine = config.admin?.custom?.reservationStatusMachine as
    | {
        blockingStatuses?: string[]
        defaultStatus?: string
        statuses?: string[]
        terminalStatuses?: string[]
        transitions?: Record<string, string[]>
      }
    | undefined

  // The initial/pending status (what "pending" view shows)
  const defaultStatus = statusMachine?.defaultStatus ?? 'pending'

  // Labels, colours, and confirm/cancel targets, all derived from the resolved
  // status machine — shared with every other status-aware admin component.
  const {
    cancelStatus,
    confirmStatus,
    labels: STATUS_LABELS,
    presentation: STATUS_PRESENTATION,
    statuses: allStatuses,
  } = useReservationStatusMachine()

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  // { shown, total } when a fetch hit its cap, else null — drives a non-silent notice (D9)
  const [truncation, setTruncation] = useState<{ shown: number; total: number } | null>(null)
  // Monotonic request counters so a slow earlier fetch can't overwrite a newer one (D5)
  const reservationsSeq = useRef(0)
  const pendingSeq = useRef(0)
  const [drawerDocId, setDrawerDocId] = useState<null | string>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown> | undefined>(undefined)

  // Resource filter state
  const [resources, setResources] = useState<ResourceOption[]>([])
  const [selectedResourceId, setSelectedResourceId] = useState<string>('')

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

  // The drawer's modal slug embeds `drawerDocId`, so `openDrawer()` cannot run in
  // the click handler — it would target the previously-opened document. It has to
  // wait for the render that carries the new id. `openRequest` is what schedules
  // that render: bumping a counter always produces a new value, whereas setting
  // `drawerDocId`/`initialData` to what they already hold makes React bail out of
  // the re-render entirely, silently swallowing the click (reopening the document
  // you just closed, or "Create New" on a calendar where nothing has been opened).
  const [openRequest, setOpenRequest] = useState(0)

  const requestDrawer = useCallback((id: null | string, data?: Record<string, unknown>) => {
    setDrawerDocId(id)
    setInitialData(data)
    setOpenRequest((n) => n + 1)
  }, [])

  useEffect(() => {
    if (openRequest === 0) {
      return
    }
    openDrawer()
    // Deliberately keyed on `openRequest` alone. `openDrawer`'s identity also tracks
    // the modal context value, and re-firing on that would reopen a closed drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest])

  // Fetch active resources for filter dropdown
  useEffect(() => {
    const fetchResources = async () => {
      try {
        const params = new URLSearchParams({
          depth: '0',
          limit: '100',
          sort: 'name',
          'where[active][equals]': 'true',
          ...resourceTenantParams,
        })
        const url = `${config.serverURL ?? ''}${config.routes.api}/${resourceSlug}?${params}`
        const response = await fetch(url)
        const result = await response.json()
        const docs: Array<{ id: string; name?: string }> = result.docs ?? []
        setResources(docs.map((d) => ({ id: d.id, name: d.name ?? '' })))
        // Single-resource installs have no resource filter (it renders only for 2+),
        // so nothing could ever select the resource and the week/day availability
        // shading (off-shift / full / time-off / external) never loaded. Auto-select
        // the sole resource; with 2+ the user chooses via the filter as before.
        if (docs.length === 1) {
          setSelectedResourceId((prev) => prev || String(docs[0].id))
        }
      } catch {
        setResources([])
      }
    }
    void fetchResources()
  }, [config.routes.api, config.serverURL, resourceSlug, resourceTenantParams])

  const { rangeEnd, rangeStart } = useMemo(() => {
    const currentKey = getDayKeyInTimezone(currentDate, reservationTimezone)
    let startKey: string
    let dayCount: number
    if (viewMode === 'month') {
      // The grid always renders 42 cells (6 weeks); fetch the same span so
      // trailing weeks aren't silently empty (review D1).
      startKey = monthGridStartDayKey(currentKey)
      dayCount = 42
    } else if (viewMode === 'week') {
      startKey = startOfWeekDayKey(currentKey)
      dayCount = 7
    } else {
      startKey = currentKey
      dayCount = 1
    }

    return {
      rangeEnd: instantAtHour(addDaysToDayKey(startKey, dayCount), 0, reservationTimezone),
      rangeStart: instantAtHour(startKey, 0, reservationTimezone),
    }
  }, [currentDate, reservationTimezone, viewMode])

  // Availability data for the selected resource (null when no resource selected — grid unshaded)
  const { data: availability } = useResourceAvailability(
    apiBase,
    selectedResourceId || undefined,
    rangeStart,
    rangeEnd,
  )

  const fetchReservations = useCallback(async () => {
    const seq = ++reservationsSeq.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        depth: '1',
        limit: String(MAX_LIST_LIMIT),
        sort: 'startTime',
        'where[startTime][greater_than_equal]': rangeStart.toISOString(),
        // rangeEnd is exclusive (midnight starting the day after the last
        // rendered day), so the bound must be too — a reservation starting
        // exactly at that midnight belongs to the next span, not this one.
        'where[startTime][less_than]': rangeEnd.toISOString(),
        ...reservationTenantParams,
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      if (seq !== reservationsSeq.current) {return} // a newer fetch superseded this one
      const docs = result.docs ?? []
      setReservations(docs)
      const total = result.totalDocs ?? docs.length
      setTruncation(total > docs.length ? { shown: docs.length, total } : null)
    } catch {
      if (seq !== reservationsSeq.current) {return}
      setReservations([])
    }
    if (seq === reservationsSeq.current) {setLoading(false)}
  }, [rangeStart, rangeEnd, apiUrl, reservationTenantParams])

  useEffect(() => {
    void fetchReservations()
  }, [fetchReservations])

  // Fetch pending count (always, for badge) — uses defaultStatus from config
  const fetchPendingCount = useCallback(async () => {
    try {
      // limit:1 + depth:0 returns totalDocs (the full count) without downloading
      // every pending doc — limit:0 in Payload means "no limit" (review D9).
      const params = new URLSearchParams({
        depth: '0',
        limit: '1',
        'where[status][equals]': defaultStatus,
        ...reservationTenantParams,
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      setPendingCount(result.totalDocs ?? 0)
    } catch {
      // silently ignore
    }
  }, [apiUrl, defaultStatus, reservationTenantParams])

  useEffect(() => {
    void fetchPendingCount()
  }, [fetchPendingCount])

  // Fetch pending reservations when tab is active — uses defaultStatus from config
  const fetchPendingReservations = useCallback(async () => {
    const seq = ++pendingSeq.current
    try {
      const params = new URLSearchParams({
        depth: '1',
        limit: String(MAX_LIST_LIMIT),
        sort: 'startTime',
        'where[status][equals]': defaultStatus,
        ...reservationTenantParams,
      })
      const response = await fetch(`${apiUrl}?${params}`)
      const result = await response.json()
      if (seq !== pendingSeq.current) {return}
      setPendingReservations(result.docs ?? [])
    } catch {
      if (seq !== pendingSeq.current) {return}
      setPendingReservations([])
    }
  }, [apiUrl, defaultStatus, reservationTenantParams])

  useEffect(() => {
    if (viewMode === 'pending') {
      void fetchPendingReservations()
    }
  }, [viewMode, fetchPendingReservations])

  // Client-side resource filtering. Delegated to a pure, unit-tested helper:
  // ids MUST be compared string-normalized — Postgres serves numeric ids over
  // REST while the filter/auto-select value is a string, and strict `===` on
  // the raw values filtered out EVERY reservation on Postgres installs.
  const matchesResourceFilter = useCallback(
    (r: Reservation): boolean => reservationMatchesResource(r, selectedResourceId),
    [selectedResourceId],
  )

  const filteredReservations = useMemo(
    () => reservations.filter(matchesResourceFilter),
    [reservations, matchesResourceFilter],
  )

  const filteredPendingReservations = useMemo(
    () => pendingReservations.filter(matchesResourceFilter),
    [pendingReservations, matchesResourceFilter],
  )

  // Clear selection when leaving pending view or changing resource filter
  useEffect(() => {
    if (viewMode !== 'pending') {
      setSelectedIds(new Set())
      setActionFeedback(null)
    }
  }, [viewMode])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedResourceId])

  // Auto-clear feedback toast
  useEffect(() => {
    if (!actionFeedback) {return}
    const timer = setTimeout(() => setActionFeedback(null), 4000)
    return () => clearTimeout(timer)
  }, [actionFeedback])

  // Uses confirmStatus derived from config transitions
  const handleQuickConfirm = useCallback(
    async (id: string) => {
      setConfirmingIds((prev) => new Set(prev).add(id))
      const result = await transitionReservation(id, confirmStatus)
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setActionFeedback({
        type: result.ok ? 'success' : 'error',
        // The server's own message on failure — a notice-period rejection used to
        // render as the generic pendingConfirmError string.
        message: result.ok ? t('reservation:pendingConfirmSuccess') : result.message,
      })
      if (result.ok) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        void fetchPendingReservations()
        void fetchPendingCount()
      }
    },
    [transitionReservation, fetchPendingReservations, fetchPendingCount, t, confirmStatus],
  )

  // Uses cancelStatus derived from config transitions
  const handleQuickCancel = useCallback(
    async (id: string) => {
      setConfirmingIds((prev) => new Set(prev).add(id))
      const result = await cancelReservation(id, cancelStatus)
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setActionFeedback({
        type: result.ok ? 'success' : 'error',
        // The server's own message on failure — a notice-period rejection used to
        // render as the generic pendingCancelError string.
        message: result.ok ? t('reservation:pendingCancelSuccess') : result.message,
      })
      if (result.ok) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        void fetchPendingReservations()
        void fetchPendingCount()
      }
    },
    [cancelReservation, fetchPendingReservations, fetchPendingCount, t, cancelStatus],
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
      ids.map((id) => transitionReservation(id, confirmStatus).then((r) => r.ok)),
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
  }, [
    selectedIds,
    transitionReservation,
    fetchPendingReservations,
    fetchPendingCount,
    t,
    confirmStatus,
  ])

  // Placeholder — Task 11 replaces this body with the real detail-drawer open.
  const openDetail = (id: string) => requestDrawer(id)

  const handleCreateNew = useCallback(() => {
    requestDrawer(null)
  }, [requestDrawer])

  const handleDateClick = useCallback(
    (date: Date) => {
      requestDrawer(null, { startTime: date.toISOString() })
    },
    [requestDrawer],
  )

  // Click-to-book: open new-reservation drawer pre-filled with startTime + optional resource
  const handleSlotClick = useCallback(
    (startIso: string) => {
      requestDrawer(null, {
        ...(selectedResourceId ? { resource: selectedResourceId } : {}),
        startTime: startIso,
      })
    },
    [requestDrawer, selectedResourceId],
  )

  // Lane-specific book: pre-fills both the specific resource and startTime
  const handleLaneBook = useCallback(
    (resourceId: string, startIso: string) => {
      requestDrawer(null, { resource: resourceId, startTime: startIso })
    },
    [requestDrawer],
  )

  const openDocDrawer = useCallback(
    (id: string) => {
      requestDrawer(id)
    },
    [requestDrawer],
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
          // day, lanes: step one day at a time
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
      timeZone: reservationTimezone,
    })
    const serviceName = getResName(r.service)
    if (compact) {
      return `${time} ${serviceName}`.trim()
    }
    const customerName = getCustomerName(r.customer)
    const parts = [time, serviceName, customerName].filter(Boolean)
    return parts.join(' - ')
  }

  // Returns all resource names for a reservation — from items array if present, otherwise top-level resource
  const getResourceNames = (r: Reservation): string[] => {
    if (r.items && r.items.length > 0) {
      const names = r.items
        .map((item) => getResName(item.resource))
        .filter((name) => name.length > 0)
      if (names.length > 0) {return names}
    }
    const single = getResName(r.resource)
    return single ? [single] : []
  }

  const getEventTooltip = (r: Reservation): string => {
    const serviceName = getResName(r.service) || t('reservation:calendarUnknownService')
    const startStr = new Date(r.startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: reservationTimezone,
    })
    const endStr = r.endTime
      ? new Date(r.endTime).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: reservationTimezone,
        })
      : '?'
    const customerName = getCustomerName(r.customer) || t('reservation:calendarUnknownCustomer')
    const resourceNames = getResourceNames(r)
    const resourceStr =
      resourceNames.length > 0
        ? resourceNames.join(', ')
        : t('reservation:calendarUnknownResource')
    const status = STATUS_LABELS[r.status] ?? r.status
    return [
      serviceName,
      `${startStr} - ${endStr}`,
      `${t('reservation:tooltipCustomer')} ${customerName}`,
      `${t('reservation:tooltipResource')} ${resourceStr}`,
      `${t('reservation:tooltipStatus')} ${status}`,
    ].join('\n')
  }

  const renderEventItem = (r: Reservation, compact: boolean) => {
    const hasItems = Array.isArray(r.items) && r.items.length > 0
    return (
      <EventPill
        compact={compact}
        key={r.id}
        label={getEventLabel(r, compact)}
        onSelect={openDetail}
        presentation={STATUS_PRESENTATION[r.status]}
        reservation={r}
        tooltip={getEventTooltip(r)}
      >
        {hasItems && (
          <div className={styles.itemBadges}>
            {r.items!.map((it, i) => {
              const name = typeof it.resource === 'object' ? it.resource?.name : it.resource
              return (
                <span className={styles.itemBadge} key={i}>
                  {String(name ?? '')}
                </span>
              )
            })}
          </div>
        )}
      </EventPill>
    )
  }

  // Dynamic legend: iterates all statuses from the status machine config
  const renderStatusLegend = () => {
    const statuses = allStatuses
    return (
      <div className={styles.statusLegend}>
        {statuses.map((key) => (
          <div className={styles.legendItem} key={key}>
            <span
              className={styles.legendDot}
              style={{ background: STATUS_PRESENTATION[key]?.background }}
            />
            {STATUS_LABELS[key] ?? key}
          </div>
        ))}
      </div>
    )
  }

  const renderCurrentTimeLine = (cellDayKey: string, cellHour: number) => {
    const now = new Date()
    if (
      getDayKeyInTimezone(now, reservationTimezone) !== cellDayKey ||
      getHourInTimezone(now, reservationTimezone) !== cellHour
    ) {
      return null
    }
    const topPercent = (now.getMinutes() / 60) * 100
    return <div className={styles.currentTimeLine} style={{ top: `${topPercent}%` }} />
  }

  const renderMonthView = () => {
    const currentKey = getDayKeyInTimezone(currentDate, reservationTimezone)
    const dayKeys = dayKeySequence(monthGridStartDayKey(currentKey), 42)

    const today = new Date()
    const todayStr = getDayKeyInTimezone(today, reservationTimezone)

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
        {dayKeys.map((dayKey, i) => {
          const isToday = dayKey === todayStr
          const isOtherMonth = dayKey.slice(0, 7) !== currentKey.slice(0, 7)
          const dayReservations = filteredReservations.filter((r) => {
            const rKey = getDayKeyInTimezone(new Date(r.startTime), reservationTimezone)
            return rKey === dayKey
          })

          // External busy intervals (calendar sync etc.) overlapping this day —
          // display-only pills; enforcement already lives in checkAvailability.
          const dayExternal = (availability?.external ?? []).filter((ev) => {
            const startKey = getDayKeyInTimezone(new Date(ev.start), reservationTimezone)
            // end is exclusive: subtract 1ms so an interval ending at midnight
            // doesn't claim the next day.
            const endKey = getDayKeyInTimezone(
              new Date(new Date(ev.end).getTime() - 1),
              reservationTimezone,
            )
            return startKey <= dayKey && dayKey <= endKey
          })

          const clickDate = instantAtHour(dayKey, 9, reservationTimezone)

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
              <div className={styles.dayNumber}>{Number(dayKey.slice(8, 10))}</div>
              {dayReservations.map((r) => renderEventItem(r, true))}
              {dayExternal.map((ev, j) => (
                <div
                  className={`${eventPillStyles.eventItem} ${styles.eventItemExternal}`}
                  key={`ext-${ev.start}-${j}`}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  title={ev.label ?? t('reservation:slotExternal')}
                >
                  {externalPillLabel(ev, dayKey, reservationTimezone, t('reservation:slotExternal'))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  const renderWeekView = () => {
    const currentKey = getDayKeyInTimezone(currentDate, reservationTimezone)
    const weekDayKeys = dayKeySequence(startOfWeekDayKey(currentKey), 7)

    // Visible-hour window derived from the week's bookings (review D8)
    const weekReservations = filteredReservations.filter((r) => {
      const k = getDayKeyInTimezone(new Date(r.startTime), reservationTimezone)
      return weekDayKeys.includes(k)
    })
    const { endHour: gridEndHour, startHour: gridStartHour } = computeHourWindow(
      weekReservations,
      reservationTimezone,
    )
    const hours = Array.from({ length: gridEndHour - gridStartHour }, (_, i) => i + gridStartHour)
    const gridStep = 60

    // Build per-day slot-state maps when a resource is selected
    const daySlotMaps = availability
      ? new Map(
          weekDayKeys.map((isoDay) => {
            const dayAvail = availability.days.find((d) => d.date === isoDay)
            const dayStart = gridInstant(isoDay, gridStartHour, reservationTimezone)
            const dayEnd = gridInstant(isoDay, gridEndHour, reservationTimezone)
            const slots = dayAvail
              ? computeSlotStates({
                  busy: availability.busy,
                  capacityMode: availability.capacityMode,
                  dayEnd,
                  dayStart,
                  external: availability.external,
                  quantity: availability.quantity,
                  requiredPools: availability.requiredPools,
                  shiftWindows: dayAvail.shiftWindows,
                  step: gridStep,
                  timeOff: dayAvail.timeOff,
                })
              : []
            // Index by slot start ISO for fast lookup
            const slotByStart = new Map(slots.map((s) => [s.start.toISOString(), s]))
            return [isoDay, slotByStart] as const
          }),
        )
      : null

    return (
      <div className={styles.weekView}>
        <div className={styles.dayHeader} />
        {weekDayKeys.map((dayKey, i) => (
          <div className={styles.dayHeader} key={i}>
            {displayDateForDayKey(dayKey, reservationTimezone).toLocaleDateString([], {
              day: 'numeric',
              month: 'numeric',
              timeZone: reservationTimezone,
              weekday: 'short',
            })}
          </div>
        ))}
        {hours.map((hour) => (
          <Fragment key={`row-${hour}`}>
            <div className={styles.timeLabel}>
              {hour.toString().padStart(2, '0')}:00
            </div>
            {weekDayKeys.map((isoDay, di) => {
              const cellReservations = filteredReservations.filter((r) => {
                const rDate = new Date(r.startTime)
                return (
                  getDayKeyInTimezone(rDate, reservationTimezone) === isoDay &&
                  getHourInTimezone(rDate, reservationTimezone) === hour
                )
              })
              const clickDate = instantAtHour(isoDay, hour, reservationTimezone)

              // Slot state (only when a resource is selected)
              const slotMap = daySlotMaps?.get(isoDay)
              const slotInfo = slotMap?.get(clickDate.toISOString()) ?? null

              // Derive cell CSS class and interactivity based on slot state
              let slotClass = ''
              let isNonInteractive = false
              if (slotInfo) {
                if (slotInfo.state === 'off-shift') {
                  slotClass = styles.slotOffShift
                  isNonInteractive = true
                } else if (slotInfo.state === 'time-off') {
                  slotClass = styles.slotTimeOff
                  isNonInteractive = true
                } else if (slotInfo.state === 'external') {
                  slotClass = styles.slotExternal
                  isNonInteractive = true
                } else if (slotInfo.state === 'full') {
                  slotClass = styles.slotFull
                  isNonInteractive = true
                } else {
                  slotClass = styles.slotFree
                }
              }

              // Time-off label: show type/reason from dayAvail when in time-off state
              const dayAvail = availability?.days.find((d) => d.date === isoDay)
              const timeOffEntry =
                slotInfo?.state === 'time-off'
                  ? dayAvail?.timeOff.find(
                      (to) =>
                        new Date(to.start) <= clickDate && clickDate < new Date(to.end),
                    )
                  : undefined
              const timeOffLabel = timeOffEntry?.type ?? timeOffEntry?.reason ?? null

              const handleClick = isNonInteractive
                ? undefined
                : availability
                  ? () => handleSlotClick(clickDate.toISOString())
                  : () => handleDateClick(clickDate)
              const handleKeyDown = isNonInteractive
                ? undefined
                : (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (availability) {
                        handleSlotClick(clickDate.toISOString())
                      } else {
                        handleDateClick(clickDate)
                      }
                    }
                  }

              return (
                <div
                  className={`${styles.weekCell} ${slotClass}`}
                  key={`cell-${hour}-${di}`}
                  onClick={handleClick}
                  onKeyDown={handleKeyDown}
                  role="button"
                  tabIndex={isNonInteractive ? -1 : 0}
                >
                  {renderCurrentTimeLine(isoDay, hour)}
                  {timeOffLabel && (
                    <span className={styles.timeOffLabel}>{timeOffLabel}</span>
                  )}
                  {slotInfo && availability && availability.quantity > 1 && (
                    <span className={styles.capacityBadge}>
                      {slotInfo.occupancy}/{availability.quantity}
                    </span>
                  )}
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
    // Build slot-state map for the current day when a resource is selected
    const currentDayKey = getDayKeyInTimezone(currentDate, reservationTimezone)

    // Visible-hour window derived from this day's bookings (review D8)
    const dayReservations = filteredReservations.filter(
      (r) => getDayKeyInTimezone(new Date(r.startTime), reservationTimezone) === currentDayKey,
    )
    const { endHour: gridEndHour, startHour: gridStartHour } = computeHourWindow(
      dayReservations,
      reservationTimezone,
    )
    const hours = Array.from({ length: gridEndHour - gridStartHour }, (_, i) => i + gridStartHour)
    const gridStep = 60
    let daySlotMap: Map<string, SlotInfo> | null = null
    if (availability) {
      const isoDay = currentDayKey
      const dayAvail = availability.days.find((d) => d.date === isoDay)
      const dayStart = gridInstant(isoDay, gridStartHour, reservationTimezone)
      const dayEnd = gridInstant(isoDay, gridEndHour, reservationTimezone)
      const slots = dayAvail
        ? computeSlotStates({
            busy: availability.busy,
            capacityMode: availability.capacityMode,
            dayEnd,
            dayStart,
            external: availability.external,
            quantity: availability.quantity,
            requiredPools: availability.requiredPools,
            shiftWindows: dayAvail.shiftWindows,
            step: gridStep,
            timeOff: dayAvail.timeOff,
          })
        : []
      daySlotMap = new Map(slots.map((s) => [s.start.toISOString(), s]))
    }

    return (
      <div className={styles.dayView}>
        {hours.map((hour) => {
          const hourReservations = filteredReservations.filter((r) => {
            const rDate = new Date(r.startTime)
            return (
              getDayKeyInTimezone(rDate, reservationTimezone) === currentDayKey &&
              getHourInTimezone(rDate, reservationTimezone) === hour
            )
          })
          const clickDate = instantAtHour(currentDayKey, hour, reservationTimezone)

          // Slot state (only when a resource is selected)
          const slotInfo = daySlotMap?.get(clickDate.toISOString()) ?? null

          // Derive cell CSS class and interactivity based on slot state
          let slotClass = ''
          let isNonInteractive = false
          if (slotInfo) {
            if (slotInfo.state === 'off-shift') {
              slotClass = styles.slotOffShift
              isNonInteractive = true
            } else if (slotInfo.state === 'time-off') {
              slotClass = styles.slotTimeOff
              isNonInteractive = true
            } else if (slotInfo.state === 'external') {
              slotClass = styles.slotExternal
              isNonInteractive = true
            } else if (slotInfo.state === 'full') {
              slotClass = styles.slotFull
              isNonInteractive = true
            } else {
              slotClass = styles.slotFree
            }
          }

          // Time-off label
          const dayAvail = availability?.days.find((d) => d.date === currentDayKey)
          const timeOffEntry =
            slotInfo?.state === 'time-off'
              ? dayAvail?.timeOff.find(
                  (to) => new Date(to.start) <= clickDate && clickDate < new Date(to.end),
                )
              : undefined
          const timeOffLabel = timeOffEntry?.type ?? timeOffEntry?.reason ?? null

          const handleClick = isNonInteractive
            ? undefined
            : availability
              ? () => handleSlotClick(clickDate.toISOString())
              : () => handleDateClick(clickDate)
          const handleKeyDown = isNonInteractive
            ? undefined
            : (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (availability) {
                    handleSlotClick(clickDate.toISOString())
                  } else {
                    handleDateClick(clickDate)
                  }
                }
              }

          return (
            <Fragment key={`row-${hour}`}>
              <div className={styles.timeLabel}>
                {hour.toString().padStart(2, '0')}:00
              </div>
              <div
                className={`${styles.dayViewCell} ${slotClass}`}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                role="button"
                tabIndex={isNonInteractive ? -1 : 0}
              >
                {renderCurrentTimeLine(currentDayKey, hour)}
                {timeOffLabel && (
                  <span className={styles.timeOffLabel}>{timeOffLabel}</span>
                )}
                {slotInfo && availability && availability.quantity > 1 && (
                  <span className={styles.capacityBadge}>
                    {slotInfo.occupancy}/{availability.quantity}
                  </span>
                )}
                {hourReservations.map((r) => renderEventItem(r, false))}
              </div>
            </Fragment>
          )
        })}
      </div>
    )
  }

  const renderPendingView = () => {
    if (filteredPendingReservations.length === 0) {
      return <div className={styles.pendingEmpty}>{t('reservation:pendingEmpty')}</div>
    }

    const allSelected =
      filteredPendingReservations.length > 0 &&
      filteredPendingReservations.every((r) => selectedIds.has(r.id))

    const toggleSelectAll = () => {
      if (allSelected) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(filteredPendingReservations.map((r) => r.id)))
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
        timeZone: reservationTimezone,
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
            {filteredPendingReservations.map((r) => {
              const isConfirming = confirmingIds.has(r.id)
              // Show all resources from items array if present, else top-level resource
              const resourceDisplay =
                getResourceNames(r).join(', ') || t('reservation:calendarUnknownResource')
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
                  <td className={styles.pendingTd}>{resourceDisplay}</td>
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

  // The header must name the same span the grid renders, so it resolves the
  // month/week in the BUSINESS zone exactly as renderMonthView/renderWeekView do.
  // Deriving it from viewer-zone Date math instead lets the label drift a day —
  // and, at a week boundary, a whole week — away from the cells below it.
  const dateLabel = useMemo(() => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString([], {
        month: 'long',
        timeZone: reservationTimezone,
        year: 'numeric',
      })
    }
    if (viewMode === 'week') {
      const startKey = startOfWeekDayKey(getDayKeyInTimezone(currentDate, reservationTimezone))
      const start = displayDateForDayKey(startKey, reservationTimezone).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        timeZone: reservationTimezone,
      })
      const end = displayDateForDayKey(
        addDaysToDayKey(startKey, 6),
        reservationTimezone,
      ).toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        timeZone: reservationTimezone,
        year: 'numeric',
      })
      return `${start} - ${end}`
    }
    return currentDate.toLocaleDateString([], {
      day: 'numeric',
      month: 'long',
      timeZone: reservationTimezone,
      weekday: 'long',
      year: 'numeric',
    })
  }, [currentDate, reservationTimezone, viewMode])

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
            { key: 'lanes' as ViewMode, label: t('reservation:calendarLanes') },
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
                <span className={styles.pendingBadge}>
                  {selectedResourceId ? filteredPendingReservations.length : pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {viewMode !== 'pending' && renderStatusLegend()}
      {viewMode !== 'pending' && truncation && (
        <div className={styles.truncationNotice} role="status">
          {t('reservation:calendarShowingNofM', {
            shown: String(truncation.shown),
            total: String(truncation.total),
          })}
        </div>
      )}
      {resources.length > 1 && (
        <div className={styles.filterBar}>
          <select
            aria-label={t('reservation:filterByResource')}
            className={styles.resourceFilter}
            onChange={(e) => setSelectedResourceId(e.target.value)}
            value={selectedResourceId}
          >
            <option value="">{t('reservation:filterAllResources')}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {loading && viewMode !== 'pending' && viewMode !== 'lanes' ? (
        <div className={styles.loading}>{t('reservation:calendarLoading')}</div>
      ) : (
        <>
          {viewMode === 'month' && renderMonthView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'day' && renderDayView()}
          {viewMode === 'lanes' &&
            (() => {
              const laneDayKey = getDayKeyInTimezone(currentDate, reservationTimezone)
              const { endHour, startHour } = computeHourWindow(
                filteredReservations.filter(
                  (r) =>
                    getDayKeyInTimezone(new Date(r.startTime), reservationTimezone) === laneDayKey,
                ),
                reservationTimezone,
              )
              return (
                <LaneTimelineView
                  apiBase={apiBase}
                  day={currentDate}
                  endHour={endHour}
                  onBook={handleLaneBook}
                  resources={
                    selectedResourceId
                      ? resources.filter((r) => sameId(r.id, selectedResourceId))
                      : resources
                  }
                  startHour={startHour}
                  timeZone={reservationTimezone}
                />
              )
            })()}
        </>
      )}
      {viewMode === 'pending' && renderPendingView()}
      <DocumentDrawer initialData={initialData} onSave={handleDrawerSave} />
    </div>
  )
}

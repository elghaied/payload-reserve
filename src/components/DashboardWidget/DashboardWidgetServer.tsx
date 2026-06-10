import type { Where, WidgetServerProps } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { StatusMachineConfig } from '../../types.js'

import { collectionHasTenantField, readCookie, tenantWhereClause } from '../../utilities/tenantFilter.js'
import {
  addDaysToDayKey,
  combineDayKeyAndTime,
  getDayKeyInTimezone,
} from '../../utilities/timezoneUtils.js'
import styles from './DashboardWidget.module.css'

export const DashboardWidgetServer = async (props: WidgetServerProps) => {
  const { req } = props
  const { i18n, payload } = req
  const t = i18n.t as PluginT

  const slugs = payload.config.admin?.custom?.reservationSlugs
  if (!slugs) {
    return null
  }

  const tenantConfig =
    (payload.config.admin?.custom?.reservationTenant as
      | { cookieName?: string; tenantField?: string }
      | undefined) ?? {}
  const cookieName = tenantConfig.cookieName ?? 'payload-tenant'
  const tenantField = tenantConfig.tenantField ?? 'tenant'
  const reservationsCollection = payload.config.collections?.find((c) => c.slug === slugs.reservations)
  const tenantWhere = tenantWhereClause({
    hasField: collectionHasTenantField(reservationsCollection as { fields?: unknown[] } | undefined, tenantField),
    tenantField,
    tenantId: readCookie(req.headers.get('cookie'), cookieName),
  })

  // Read status machine from config — never hardcode status values
  const statusMachine: StatusMachineConfig | undefined =
    payload.config.admin?.custom?.reservationStatusMachine
  const blockingStatuses: string[] = statusMachine?.blockingStatuses ?? []
  const terminalStatuses: string[] = statusMachine?.terminalStatuses ?? []
  const blockingSet = new Set(blockingStatuses)
  const terminalSet = new Set(terminalStatuses)

  // "Today" is the business timezone's calendar day, not the server's
  const reservationTimezone: string =
    payload.config.admin?.custom?.reservationTimezone ?? 'UTC'
  const now = new Date()
  const todayKey = getDayKeyInTimezone(now, reservationTimezone)
  const startOfDay = combineDayKeyAndTime(todayKey, '00:00', reservationTimezone)
  const endOfDay = combineDayKeyAndTime(addDaysToDayKey(todayKey, 1), '00:00', reservationTimezone)

  const where: Where = {
    startTime: {
      greater_than_equal: startOfDay.toISOString(),
      less_than: endOfDay.toISOString(),
    },
  }
  if (tenantWhere) {
    Object.assign(where, tenantWhere)
  }

  // Stats are computed with count queries rather than a capped fetch+filter,
  // so they stay accurate past 100 reservations/day (review D7).
  const blocking = Array.from(blockingSet)
  const terminalArr = Array.from(terminalSet)
  const countWhere = (extra?: Where): Where => (extra ? { and: [where, extra] } : where)

  const [total, active, terminal, upcoming, nextResult] = await Promise.all([
    payload.count({ collection: slugs.reservations, where }).then((r) => r.totalDocs),
    blocking.length
      ? payload
          .count({ collection: slugs.reservations, where: countWhere({ status: { in: blocking } }) })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    terminalArr.length
      ? payload
          .count({
            collection: slugs.reservations,
            where: countWhere({ status: { in: terminalArr } }),
          })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    blocking.length
      ? payload
          .count({
            collection: slugs.reservations,
            where: countWhere({
              and: [{ status: { in: blocking } }, { startTime: { greater_than: now.toISOString() } }],
            }),
          })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    blocking.length
      ? payload.find({
          collection: slugs.reservations,
          limit: 1,
          sort: 'startTime',
          where: countWhere({
            and: [{ status: { in: blocking } }, { startTime: { greater_than: now.toISOString() } }],
          }),
        })
      : Promise.resolve({ docs: [] as Record<string, unknown>[] }),
  ])

  // Next appointment = the earliest upcoming blocking reservation
  const nextAppointment = nextResult.docs[0] as Record<string, unknown> | undefined

  return (
    <div className={styles.wrapper}>
      <h3 className={styles.title}>{t('reservation:dashboardTitle')}</h3>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{total}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardTotal')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{active}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardActive')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{upcoming}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardUpcoming')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{terminal}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardTerminal')}</span>
        </div>
      </div>
      {nextAppointment ? (
        <div className={styles.nextAppointment}>
          <strong>{t('reservation:dashboardNextAppointment')}</strong>
          <p>
            {t('reservation:dashboardTime')}{' '}
            {new Date(nextAppointment.startTime as string).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: reservationTimezone,
            })}
          </p>
          <p>
            {t('reservation:dashboardStatus')} {nextAppointment.status as string}
          </p>
        </div>
      ) : (
        <p className={styles.noData}>{t('reservation:dashboardNoUpcoming')}</p>
      )}
    </div>
  )
}

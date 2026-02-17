import type { WidgetServerProps } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { StatusMachineConfig } from '../../types.js'

import styles from './DashboardWidget.module.css'

export const DashboardWidgetServer = async (props: WidgetServerProps) => {
  const { req } = props
  const { i18n, payload } = req
  const t = i18n.t as PluginT

  const slugs = payload.config.admin?.custom?.reservationSlugs
  if (!slugs) {
    return null
  }

  // Read status machine from config — never hardcode status values
  const statusMachine: StatusMachineConfig | undefined =
    payload.config.admin?.custom?.reservationStatusMachine
  const blockingStatuses: string[] = statusMachine?.blockingStatuses ?? []
  const terminalStatuses: string[] = statusMachine?.terminalStatuses ?? []
  const blockingSet = new Set(blockingStatuses)
  const terminalSet = new Set(terminalStatuses)

  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  const { docs: todayReservations } = await payload.find({
    collection: slugs.reservations,
    limit: 100,
    sort: 'startTime',
    where: {
      startTime: {
        greater_than_equal: startOfDay.toISOString(),
        less_than: endOfDay.toISOString(),
      },
    },
  })

  const total = todayReservations.length

  // Active = reservations in blockingStatuses (they hold a slot, past or future)
  const active = todayReservations.filter((r: Record<string, unknown>) =>
    blockingSet.has(r.status as string),
  ).length

  // Upcoming = active (blocking) reservations that haven't started yet
  const upcoming = todayReservations.filter(
    (r: Record<string, unknown>) =>
      blockingSet.has(r.status as string) && new Date(r.startTime as string) > now,
  ).length

  // Terminal = reservations in terminalStatuses (completed, cancelled, no-show, etc.)
  const terminal = todayReservations.filter((r: Record<string, unknown>) =>
    terminalSet.has(r.status as string),
  ).length

  // Next appointment = the earliest upcoming blocking reservation
  const nextAppointment = todayReservations.find(
    (r: Record<string, unknown>) =>
      blockingSet.has(r.status as string) && new Date(r.startTime as string) > now,
  )

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

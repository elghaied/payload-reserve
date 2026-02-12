import type { ServerComponentProps } from 'payload'

import type { PluginT } from '../../translations/index.js'

import styles from './DashboardWidget.module.css'

export const DashboardWidgetServer = async (props: ServerComponentProps) => {
  const { i18n, payload } = props
  const t = i18n.t as PluginT

  const slugs = payload.config.admin?.custom?.reservationSlugs
  if (!slugs) {
    return null
  }

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
  const upcoming = todayReservations.filter(
    (r: Record<string, unknown>) =>
      r.status !== 'completed' && r.status !== 'cancelled' && r.status !== 'no-show' &&
      new Date(r.startTime as string) > now,
  ).length
  const completed = todayReservations.filter(
    (r: Record<string, unknown>) => r.status === 'completed',
  ).length
  const cancelled = todayReservations.filter(
    (r: Record<string, unknown>) => r.status === 'cancelled',
  ).length

  const nextAppointment = todayReservations.find(
    (r: Record<string, unknown>) =>
      r.status !== 'completed' && r.status !== 'cancelled' && r.status !== 'no-show' &&
      new Date(r.startTime as string) > now,
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
          <span className={styles.statValue}>{upcoming}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardUpcoming')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{completed}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardCompleted')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{cancelled}</span>
          <span className={styles.statLabel}>{t('reservation:dashboardCancelled')}</span>
        </div>
      </div>
      {nextAppointment ? (
        <div className={styles.nextAppointment}>
          <strong>{t('reservation:dashboardNextAppointment')}</strong>
          <p>
            {t('reservation:dashboardTime')} {new Date(nextAppointment.startTime as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p>{t('reservation:dashboardStatus')} {nextAppointment.status as string}</p>
        </div>
      ) : (
        <p className={styles.noData}>{t('reservation:dashboardNoUpcoming')}</p>
      )}
    </div>
  )
}

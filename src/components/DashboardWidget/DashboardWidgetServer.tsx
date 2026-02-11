import type { ServerComponentProps } from 'payload'

import styles from './DashboardWidget.module.css'

export const DashboardWidgetServer = async (props: ServerComponentProps) => {
  const { payload } = props

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
      <h3 className={styles.title}>Today&apos;s Reservations</h3>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{total}</span>
          <span className={styles.statLabel}>Total</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{upcoming}</span>
          <span className={styles.statLabel}>Upcoming</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{completed}</span>
          <span className={styles.statLabel}>Completed</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{cancelled}</span>
          <span className={styles.statLabel}>Cancelled</span>
        </div>
      </div>
      {nextAppointment ? (
        <div className={styles.nextAppointment}>
          <strong>Next Appointment</strong>
          <p>
            Time: {new Date(nextAppointment.startTime as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p>Status: {nextAppointment.status as string}</p>
        </div>
      ) : (
        <p className={styles.noData}>No upcoming appointments today.</p>
      )}
    </div>
  )
}

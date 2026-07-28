import type { Payload, PayloadRequest, Where } from 'payload'

export type DashboardStats = {
  active: number
  nextAppointment: Record<string, unknown> | undefined
  terminal: number
  total: number
  upcoming: number
}

/**
 * The dashboard widget's five aggregate reads, split out of the RSC so they can
 * be tested against a real Payload instance — a React Server Component has no
 * render harness in this repo.
 *
 * Every read is access-checked (`overrideAccess: false` + `req`). Counts are
 * used rather than a capped fetch+filter so they stay accurate past 100
 * reservations/day (review D7).
 *
 * `disableErrors: true` is load-bearing, not defensive noise. When an access
 * function returns boolean `false` — multi-tenant's `withTenantAccess` does
 * exactly that for a user with no tenant memberships, and any consumer-supplied
 * `access.reservations.read` may too — Payload's `executeAccess` THROWS
 * `Forbidden` unless errors are disabled. This helper runs inside an async React
 * Server Component, so that throw is a dashboard render failure, not a status
 * code. With the flag, `count`/`find` short-circuit to `{ totalDocs: 0 }` /
 * `{ docs: [] }` and the widget renders zeros — which is the honest answer for a
 * caller allowed to see nothing.
 */
export async function fetchDashboardStats(args: {
  blockingStatuses: string[]
  now: Date
  payload: Payload
  req: PayloadRequest
  reservationsSlug: string
  terminalStatuses: string[]
  where: Where
}): Promise<DashboardStats> {
  const { blockingStatuses, now, payload, req, reservationsSlug, terminalStatuses, where } = args

  // The slug is resolved at runtime from admin.custom, so it is a plain string
  // rather than a literal CollectionSlug — the same cast the rest of the plugin uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collection = reservationsSlug as any
  const countWhere = (extra?: Where): Where => (extra ? { and: [where, extra] } : where)
  const upcomingWhere = countWhere({
    and: [{ status: { in: blockingStatuses } }, { startTime: { greater_than: now.toISOString() } }],
  })

  // Concurrency is safe despite the shared `req`: createLocalReq mutates it, but
  // its only await sits behind `req?.i18n ||`, and a real request always carries
  // i18n — so each call's mutations complete synchronously with no interleaving.
  const [total, active, terminal, upcoming, nextResult] = await Promise.all([
    payload
      .count({ collection, disableErrors: true, overrideAccess: false, req, where })
      .then((r) => r.totalDocs),
    blockingStatuses.length
      ? payload
          .count({
            collection,
            disableErrors: true,
            overrideAccess: false,
            req,
            where: countWhere({ status: { in: blockingStatuses } }),
          })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    terminalStatuses.length
      ? payload
          .count({
            collection,
            disableErrors: true,
            overrideAccess: false,
            req,
            where: countWhere({ status: { in: terminalStatuses } }),
          })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    blockingStatuses.length
      ? payload
          .count({
            collection,
            disableErrors: true,
            overrideAccess: false,
            req,
            where: upcomingWhere,
          })
          .then((r) => r.totalDocs)
      : Promise.resolve(0),
    blockingStatuses.length
      ? payload.find({
          collection,
          disableErrors: true,
          limit: 1,
          overrideAccess: false,
          req,
          sort: 'startTime',
          where: upcomingWhere,
        })
      : Promise.resolve({ docs: [] as Record<string, unknown>[] }),
  ])

  return {
    active,
    // Next appointment = the earliest upcoming blocking reservation
    nextAppointment: nextResult.docs[0] as Record<string, unknown> | undefined,
    terminal,
    total,
    upcoming,
  }
}

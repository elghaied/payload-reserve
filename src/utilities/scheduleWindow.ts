import type { PayloadRequest } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { resolveScheduleForDate } from './scheduleUtils.js'
import { getDayKeyInTimezone } from './timezoneUtils.js'

type Range = { end: Date; start: Date }

/** Merge overlapping or touching ranges so a window can span two schedules. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start.getTime() <= last.end.getTime()) {
      if (r.end > last.end) {
        last.end = r.end
      }
    } else {
      out.push({ end: r.end, start: r.start })
    }
  }
  return out
}

/**
 * Whether `[start, end)` lies inside the resource's schedule for that business
 * day — the same resolution `/reserve/slots` advertises, applied on the write
 * path. Before this, the availability endpoints were advisory only: a booking at
 * 03:00, on a vacation day, or last week was accepted if the slot was free.
 *
 * A `full-day` service's end is the business end-of-day, which is past every
 * shift range, so only its start is checked. Runs ONE `find` on the caller's
 * `req` (sequential, transaction-safe).
 */
export async function isWithinSchedule({
  config,
  end,
  fullDay = false,
  req,
  resourceId,
  start,
}: {
  config: Pick<ResolvedReservationPluginConfig, 'slugs' | 'timezone'>
  end?: Date
  fullDay?: boolean
  req: PayloadRequest
  resourceId: number | string
  start: Date
}): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (req.payload.find as any)({
    collection: config.slugs.schedules,
    depth: 0,
    limit: 100,
    pagination: false,
    req,
    where: { resource: { equals: resourceId } },
  })) as { docs: Array<Record<string, unknown>> }
  const active = res.docs.filter((s) => s.active !== false)
  // A resource with no schedule at all is unconstrained: the host is not using
  // schedules for it (the read path advertises nothing either), and refusing
  // every public booking on it would break installs that never defined one.
  if (active.length === 0) {return true}
  const dayKey = getDayKeyInTimezone(start, config.timezone)
  const ranges = mergeRanges(
    active
      .flatMap((s) =>
        resolveScheduleForDate(
          s as unknown as Parameters<typeof resolveScheduleForDate>[0],
          dayKey,
          config.timezone,
        ),
      ),
  )
  return ranges.some(
    (r) => start >= r.start && start < r.end && (fullDay || !end || end <= r.end),
  )
}

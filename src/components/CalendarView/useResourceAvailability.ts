'use client'
import { useEffect, useState } from 'react'

import type { ResourceAvailability } from '../../endpoints/resourceAvailability.js'

/**
 * Fetch a resource's availability (shift windows, time-off, busy, capacity) for
 * a date range. Returns null when no resourceId is given (grid stays unshaded).
 */
export function useResourceAvailability(
  apiBase: string,
  resourceId: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): { data: null | ResourceAvailability; loading: boolean } {
  const [data, setData] = useState<null | ResourceAvailability>(null)
  const [loading, setLoading] = useState(false)
  const startIso = rangeStart.toISOString()
  const endIso = rangeEnd.toISOString()

  useEffect(() => {
    if (!resourceId) {
      setData(null)
      return
    }
    // Drop a stale response: switching resource A→B while A's request is in
    // flight must not shade B's grid with A's windows.
    let stale = false
    const load = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          end: endIso,
          resource: String(resourceId),
          start: startIso,
        })
        const res = await fetch(`${apiBase}/reserve/resource-availability?${params.toString()}`)
        const next = res.ok ? ((await res.json()) as ResourceAvailability) : null
        if (!stale) {setData(next)}
      } catch {
        if (!stale) {setData(null)}
      } finally {
        if (!stale) {setLoading(false)}
      }
    }
    void load()
    return () => {
      stale = true
    }
  }, [apiBase, resourceId, startIso, endIso])

  return { data, loading }
}

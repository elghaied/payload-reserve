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
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `${apiBase}/reserve/resource-availability?resource=${resourceId}&start=${startIso}&end=${endIso}`,
        )
        setData(res.ok ? ((await res.json()) as ResourceAvailability) : null)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [apiBase, resourceId, startIso, endIso])

  return { data, loading }
}

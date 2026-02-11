/**
 * Add minutes to a date and return a new Date.
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/**
 * Check if two time ranges overlap.
 * Ranges are [startA, endA) and [startB, endB) (half-open intervals).
 */
export function doRangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && startB < endA
}

/**
 * Compute the effective blocked window for a reservation,
 * applying buffer times before and after.
 */
export function computeBlockedWindow(
  startTime: Date,
  endTime: Date,
  bufferBefore: number,
  bufferAfter: number,
): { effectiveEnd: Date; effectiveStart: Date } {
  return {
    effectiveEnd: addMinutes(endTime, bufferAfter),
    effectiveStart: addMinutes(startTime, -bufferBefore),
  }
}

/**
 * Calculate hours between now and a future date.
 */
export function hoursUntil(futureDate: Date, now?: Date): number {
  const reference = now ?? new Date()
  return (futureDate.getTime() - reference.getTime()) / (1000 * 60 * 60)
}

/**
 * Retry a write that lost a transaction-level lock race.
 *
 * `acquireBookingLock` makes concurrent bookings for one resource contend on a
 * single document so the database serializes them. On MongoDB the loser does
 * not wait — it aborts immediately with a WriteConflict. That is correct for a
 * `quantity: 1` resource (only one booking should win anyway) but wrong for a
 * `quantity: 3` one, where two more bookings legitimately fit. Measured
 * without retry: 8 simultaneous bookings against a `quantity: 3` resource
 * persisted only 1.
 *
 * Retrying re-runs the whole operation on a fresh transaction. The retry takes
 * the lock cleanly, re-reads availability — now seeing the winner's committed
 * booking — and is admitted or rejected by `validateConflicts` on the merits.
 */

/** MongoDB WriteConflict. */
const MONGO_WRITE_CONFLICT = 112

/** Postgres serialization_failure and deadlock_detected. */
const POSTGRES_SERIALIZATION_FAILURES = new Set(['40P01', '40001'])

/**
 * Whether an error means "the database refused this transaction because
 * another one touched the same rows; running it again may succeed."
 *
 * Detection is by the driver's own structured signals, never by message text.
 * MongoDB tags exactly this class with the `TransientTransactionError` label,
 * which is the retry contract its drivers document; Postgres uses SQLSTATE.
 */
export function isTransientWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const { code, errorLabels } = error as { code?: unknown; errorLabels?: unknown }

  if (Array.isArray(errorLabels) && errorLabels.includes('TransientTransactionError')) {
    return true
  }

  if (code === MONGO_WRITE_CONFLICT) {
    return true
  }

  return typeof code === 'string' && POSTGRES_SERIALIZATION_FAILURES.has(code)
}

/**
 * Run `operation`, retrying only transient write conflicts.
 *
 * Every other error — a genuine booking conflict, a validation failure, an
 * access denial — propagates on the first attempt. Retrying those would turn a
 * clean rejection into a slow one.
 *
 * Backoff is exponential with full jitter, so a burst of losers does not
 * synchronise into a second stampede on the same document.
 */
export async function retryOnWriteConflict<T>(
  operation: () => Promise<T>,
  { attempts = 5, baseDelayMs = 10 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransientWriteConflict(error)) {
        throw error
      }

      lastError = error

      if (attempt < attempts - 1) {
        const ceiling = baseDelayMs * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling))
      }
    }
  }

  throw lastError
}

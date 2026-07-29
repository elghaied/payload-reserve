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
 * SQLite/libsql busy-or-locked family. Only reachable when the adapter is
 * given a truthy `transactionOptions` — otherwise `beginTransaction` is a
 * no-op and nothing ever contends. `SQLITE_BUSY` and plain `SQLITE_LOCKED`
 * are the same family as the qualified variant measured below; prefix match
 * (not an exact-set lookup like the Postgres codes above) because
 * SQLite/libsql qualify the base code with a reason suffix (`_SHAREDCACHE`,
 * `_SNAPSHOT`, ...) — the prefix is still the driver's own structured
 * signal, never message text.
 *
 * KNOWN GAP, confirmed by direct inspection, not assumption: for a loser
 * that aborts at `beginTransaction` itself (SQLite's actual failure mode —
 * a second write transaction cannot even open while one is held, rather
 * than queuing for it), this check can never fire in practice. The real
 * driver error — a `LibsqlError` with `code: 'SQLITE_LOCKED_SHAREDCACHE'` —
 * is caught *inside* `@payloadcms/drizzle`'s own `beginTransaction.js` (a
 * Payload-core dependency, not this plugin) and re-thrown as a bare
 * `new Error('Error: cannot begin transaction: ...')`: no `code`, no
 * `cause`, generic `name`. By the time it reaches this function the
 * structured signal is already gone, so retry never engages for that path
 * — measured: burst of 8 against a `quantity: 3` resource with retry
 * recovers only 1 of 3, identical to no retry at all, and raising the
 * retry budget from 5 to 30 attempts makes no difference. This match is
 * kept because it is still correct for any SQLite/libsql error shape that
 * *does* preserve `code` (a mid-transaction conflict would be a different
 * code path), and matching on the wrapped error's message text to plug this
 * specific gap is exactly what this project's structured-signal-only
 * constraint forbids.
 */
const SQLITE_BUSY_OR_LOCKED_PREFIXES = ['SQLITE_BUSY', 'SQLITE_LOCKED']

/**
 * Whether an error means "the database refused this transaction because
 * another one touched the same rows; running it again may succeed."
 *
 * Detection is by the driver's own structured signals, never by message text.
 * MongoDB tags exactly this class with the `TransientTransactionError` label,
 * which is the retry contract its drivers document; Postgres uses SQLSTATE;
 * SQLite/libsql use a `code` string in the `SQLITE_BUSY`/`SQLITE_LOCKED*`
 * family.
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

  if (typeof code !== 'string') {
    return false
  }

  return (
    POSTGRES_SERIALIZATION_FAILURES.has(code) ||
    SQLITE_BUSY_OR_LOCKED_PREFIXES.some((prefix) => code.startsWith(prefix))
  )
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
 *
 * Pass `req` whenever the operation writes through the Payload Local API. Every
 * attempt re-invokes a closure over the SAME `req`, and Payload's
 * `initTransaction` JOINS an existing `req.transactionID` rather than opening a
 * fresh transaction — so a transaction id left behind by a failed attempt would
 * make the next attempt re-enter a transaction the database already discarded.
 * Payload's own operations normally clean up after themselves (`killTransaction`
 * deletes the id from their catch), with one gap they cannot close: when
 * `beginTransaction` ITSELF rejects, `initTransaction` has already stored the
 * rejected promise on the req and `killTransaction`'s guard skips promises, so
 * the req stays poisoned — every later `initTransaction` short-circuits on
 * `instanceof Promise` and re-throws the first error without touching the
 * database. Clearing a leftover here closes it. See dev/retryTransaction.spec.ts.
 *
 * Do NOT attribute SQLite's "raising the retry budget changes nothing"
 * measurement to this. That has a different, independent cause: `@payloadcms/
 * drizzle` rethrows the driver's error as a bare `Error`, so
 * `isTransientWriteConflict` returns FALSE and this loop throws on attempt 1 —
 * attempts 2..N never happen, and poisoning never gets a chance to matter. See
 * README's "Concurrent booking: database adapter support". The shape this
 * clearing actually protects is any caller that swallows a
 * begin-transaction failure and then keeps using the same req (see the expiry
 * sweep in HoldService.takeHold).
 */
export async function retryOnWriteConflict<T>(
  operation: () => Promise<T>,
  {
    attempts = 5,
    baseDelayMs = 10,
    req,
  }: { attempts?: number; baseDelayMs?: number; req?: { transactionID?: unknown } } = {},
): Promise<T> {
  let lastError: unknown

  // Only leftovers from a failed attempt are ours to clear. A req that arrives
  // already inside a transaction belongs to an enclosing caller: dropping that
  // id would silently detach the retried write from their unit of work.
  const callerOwnsTransaction = req ? req.transactionID !== undefined : false

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && req && !callerOwnsTransaction && req.transactionID !== undefined) {
      delete req.transactionID
    }

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

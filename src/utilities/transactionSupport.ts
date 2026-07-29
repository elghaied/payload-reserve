import type { Payload } from 'payload'

/**
 * Whether this database will actually give the plugin a transaction.
 *
 * It matters because `acquireBookingLock` is only meaningful inside one. Without
 * a transaction the lock write still happens but serializes nothing, so
 * concurrent bookings silently double-book exactly as they did before the lock
 * existed — a failure that is open rather than closed, and invisible.
 *
 * Payload's mongoose adapter returns null from `beginTransaction` when the
 * connection is not a replica set. Probing costs one no-op transaction at boot.
 */
export async function supportsTransactions(payload: Payload): Promise<boolean> {
  const db = payload.db as {
    beginTransaction?: (options?: unknown) => Promise<null | number | string>
    rollbackTransaction?: (id: unknown) => Promise<void>
  }

  if (typeof db?.beginTransaction !== 'function') {
    return false
  }

  try {
    const id = await db.beginTransaction()
    if (id === null || id === undefined) {
      return false
    }
    await db.rollbackTransaction?.(id)
    return true
  } catch {
    // An adapter that throws here cannot give us a transaction, which is the
    // only thing the caller needs to know.
    return false
  }
}

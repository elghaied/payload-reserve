/**
 * Does every retry attempt get a CLEAN `req`?
 *
 * `retryOnWriteConflict` re-invokes a closure that captures one `req` object, and
 * Payload's `initTransaction` JOINS an existing `req.transactionID` instead of
 * opening a fresh transaction. If an attempt could leave its (already aborted)
 * transaction id behind, the next attempt would re-enter a transaction the
 * database has already thrown away — MongoDB answers that with
 * `NoSuchTransaction` (251, "transaction number N does not match any in-progress
 * transactions"), which carries the `TransientTransactionError` label, so every
 * remaining attempt fails the same way and `/reserve/book` returns
 * `409 retryable: true` for a genuinely free slot.
 *
 * These tests answer that with Payload's REAL `initTransaction`/`killTransaction`
 * (not a reimplementation of them) over a fake adapter, so no database is
 * involved and the transaction bookkeeping is the actual production code.
 */
import { initTransaction, killTransaction } from 'payload'
import { describe, expect, test } from 'vitest'

import { retryOnWriteConflict } from '../src/utilities/retryOnWriteConflict.js'

/** A MongoDB WriteConflict, in the shape the driver actually produces. */
const writeConflict = () =>
  Object.assign(new Error('WriteConflict'), {
    code: 112,
    errorLabels: ['TransientTransactionError'],
  })

type FakeReq = { payload: unknown; transactionID?: unknown }

function fakeAdapter(beginTransaction: () => Promise<null | string>) {
  const begun: string[] = []
  const committed: unknown[] = []
  const rolledBack: unknown[] = []
  let beginCalls = 0
  const payload = {
    db: {
      beginTransaction: async () => {
        beginCalls++
        const id = await beginTransaction()
        if (id) {
          begun.push(id)
        }
        return id
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      commitTransaction: async (id: unknown) => {
        committed.push(id)
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      rollbackTransaction: async (id: unknown) => {
        rolledBack.push(id)
      },
    },
  }
  return {
    get beginCalls() {
      return beginCalls
    },
    begun,
    committed,
    payload,
    rolledBack,
  }
}

describe('retryOnWriteConflict — transaction hygiene across attempts', () => {
  test('each attempt starts with no stale transactionID (normal abort path)', async () => {
    let n = 0
    // eslint-disable-next-line @typescript-eslint/require-await
    const adapter = fakeAdapter(async () => `txn-${++n}`)
    const req: FakeReq = { payload: adapter.payload }
    const seenAtAttemptStart: unknown[] = []

    await expect(
      retryOnWriteConflict(
        async () => {
          seenAtAttemptStart.push(req.transactionID)
          // Exactly what payload's create/update/delete operations do: open (or
          // join) a transaction, and roll it back from their own catch before
          // rethrowing (collections/operations/create.js:26 and :327-329).
          try {
            await initTransaction(req as never)
            throw writeConflict()
          } catch (error) {
            await killTransaction(req as never)
            throw error
          }
        },
        { attempts: 3, baseDelayMs: 0, req },
      ),
    ).rejects.toThrow('WriteConflict')

    // The answer: yes, clean. `killTransaction` deletes `req.transactionID`, so
    // every attempt opens its own transaction rather than re-entering a dead one.
    expect(seenAtAttemptStart).toEqual([undefined, undefined, undefined])
    expect(adapter.begun).toEqual(['txn-1', 'txn-2', 'txn-3'])
    expect(adapter.rolledBack).toEqual(['txn-1', 'txn-2', 'txn-3'])
    expect(req.transactionID).toBeUndefined()
  })

  test('a REJECTING beginTransaction does not poison the req for later attempts', async () => {
    // The one shape `killTransaction` provably cannot clean up: when
    // `beginTransaction` itself rejects, `initTransaction` has already assigned
    // the rejected promise to `req.transactionID`, and killTransaction's guard
    // (`transactionID && !(transactionID instanceof Promise)`) skips it — leaving
    // a permanently-rejecting value on the req. Every later `initTransaction`
    // then short-circuits on `instanceof Promise` and re-throws the SAME original
    // error without ever calling the adapter again, so attempts 2..N are no-ops.
    // This is not hypothetical: it is exactly the SQLite/@payloadcms/drizzle
    // failure mode, where contention surfaces at BEGIN — and it explains the
    // measurement that raising the retry budget from 5 to 30 changed nothing.
    const adapter = fakeAdapter(() => Promise.reject(writeConflict()))
    const req: FakeReq = { payload: adapter.payload }
    const seenAtAttemptStart: unknown[] = []

    await expect(
      retryOnWriteConflict(
        async () => {
          seenAtAttemptStart.push(req.transactionID)
          try {
            await initTransaction(req as never)
            return 'unreachable'
          } catch (error) {
            await killTransaction(req as never)
            throw error
          }
        },
        { attempts: 3, baseDelayMs: 0, req },
      ),
    ).rejects.toThrow('WriteConflict')

    expect(seenAtAttemptStart).toEqual([undefined, undefined, undefined])
    // Every attempt reached the adapter — proof the retry budget is real work and
    // not three replays of one poisoned promise.
    expect(adapter.beginCalls).toBe(3)
  })

  test('a transaction the CALLER already owns is never cleared', async () => {
    // The clearing is scoped to leftovers from a failed attempt. A req that
    // arrives already inside someone else's transaction must keep it, or the
    // retried write would silently detach from the enclosing unit of work.
    let n = 0
    // eslint-disable-next-line @typescript-eslint/require-await
    const adapter = fakeAdapter(async () => `inner-${++n}`)
    const req: FakeReq = { payload: adapter.payload, transactionID: 'outer-txn' }
    const seenAtAttemptStart: unknown[] = []

    await expect(
      retryOnWriteConflict(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          seenAtAttemptStart.push(req.transactionID)
          throw writeConflict()
        },
        { attempts: 3, baseDelayMs: 0, req },
      ),
    ).rejects.toThrow('WriteConflict')

    expect(seenAtAttemptStart).toEqual(['outer-txn', 'outer-txn', 'outer-txn'])
    expect(adapter.beginCalls).toBe(0)
  })

  test('works with no req passed at all (every existing call site)', async () => {
    let calls = 0
    const result = await retryOnWriteConflict(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => {
        calls++
        if (calls < 3) {
          throw writeConflict()
        }
        return 'ok'
      },
      { attempts: 5, baseDelayMs: 0 },
    )
    expect({ calls, result }).toEqual({ calls: 3, result: 'ok' })
  })
})

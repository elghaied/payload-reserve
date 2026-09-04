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

/**
 * The poisoning can also happen MID-attempt, where `retryOnWriteConflict`'s
 * between-attempts clearing cannot reach it.
 *
 * `takeHold`'s expired-row sweep is a `payload.delete` on the shared `req` with
 * an empty catch, documented as unable to fail the hold. If that delete's
 * `beginTransaction` rejects, `initTransaction` has already parked the rejected
 * promise on `req.transactionID`; the empty catch swallows the error, and the
 * `create` that follows short-circuits inside `initTransaction` and rethrows THE
 * SWEEP'S error — so the sweep fails the hold after all.
 */
describe('takeHold — a failed expiry sweep cannot poison the hold that follows', () => {
  test('the create still opens its own transaction after the sweep fails at BEGIN', async () => {
    const beginFailure = Object.assign(new Error('cannot begin transaction'), { code: 'SQLITE_X' })
    // Counted, not flagged: the sweep's OWN begin attempt must be the failing
    // one, so the discriminator has to be "which begin call is this", never a
    // flag the sweep sets before it calls begin.
    let beginCalls = 0
    let seenByCreate: unknown = 'not-called'

    // Only the sweep's BEGIN fails; the create's would succeed. Faithful to the
    // real shape: `payload.delete`/`payload.create` both call the real
    // `initTransaction` first, exactly as Payload's operations do.
    const req: FakeReq = {
      payload: {
        create: async () => {
          await initTransaction(req as never)
          seenByCreate = req.transactionID
          return { id: 'hold-1' }
        },
        db: {
          beginTransaction: () => {
            beginCalls++
            return beginCalls === 1 ? Promise.reject(beginFailure) : Promise.resolve('txn-create')
          },

          commitTransaction: async () => {},

          rollbackTransaction: async () => {},
        },
        delete: async () => {
          await initTransaction(req as never)
          return { docs: [], errors: [] }
        },
        // The schedule read behind enforceSchedule (4.1.2): no schedules, so
        // the resource is unconstrained and the hold proceeds to the write.
        // eslint-disable-next-line @typescript-eslint/require-await
        find: async () => ({ docs: [] }),
        // Service, then resource — both resolved before the write.
        // eslint-disable-next-line @typescript-eslint/require-await
        findByID: async () => ({ active: true, duration: 60, durationType: 'fixed' }),
        logger: { warn: () => {} },
      },
      user: null,
    } as FakeReq

    const { takeHold } = await import('../src/services/HoldService.js')
    const { resolveConfig } = await import('../src/defaults.js')

    const result = await takeHold({
      config: resolveConfig({ slotHolds: { enabled: true, ttlMinutes: 10 } }),
      req: req as never,
      resourceId: 'r1',
      serviceId: 's1',
      startTime: new Date('2027-03-01T10:00:00.000Z'),
    })

    // Both the sweep's failed begin AND the create's own successful one.
    // Without the clearing in the sweep's catch, the create short-circuits inside
    // `initTransaction` on the leftover rejected promise, never calls begin a
    // second time, and `takeHold` rejects with the SWEEP's error.
    expect(beginCalls).toBe(2)
    expect(result.ok).toBe(true)
    expect(seenByCreate).toBe('txn-create')
  })
})

import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createCancelBookingEndpoint } from '../src/endpoints/cancelBooking.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'
const resolved = resolveConfig({ defaultBufferTime: 10 })

describe('booking endpoint under concurrency', () => {
  test('concurrent POSTs to /reserve/book yield exactly one booking, no 500s', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Retry Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Retry Resource', active: true, quantity: 1, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'retry@example.com',
        firstName: 'Retry',
        lastName: 'User',
        password: 'test1234',
      },
    })

    const endpoint = createBookingEndpoint(resolved)
    const startTime = '2027-03-01T10:00:00.000Z'

    // Calling endpoint.handler directly (as this test does) bypasses Payload's
    // own HTTP dispatch (`handleEndpoints`/`routeError`), which is what converts
    // a thrown APIError — e.g. the genuine ValidationError a loser gets from
    // validateConflicts once it re-reads and sees the winner's committed row —
    // into a Response carrying that error's own `.status` (400 for
    // ValidationError). Promise.allSettled plus this fallback reproduces that
    // conversion so the assertions below see what a real request would.
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        endpoint.handler({
          json: () =>
            Promise.resolve({
              customer: customer.id,
              resource: resource.id,
              service: service.id,
              startTime,
            }),
          payload,
          user: { id: customer.id, collection: 'customers' },
        } as never),
      ),
    )

    const statuses = settled
      .map((r) =>
        r.status === 'fulfilled'
          ? r.value.status
          : ((r.reason as { status?: number })?.status ?? 500),
      )
      .sort()
    const created = statuses.filter((s) => s === 201).length

    // Exactly one wins. Every loser gets a deliberate 4xx — never a 500, which
    // is what a raw MongoServerError escaping the handler would produce.
    expect(created).toBe(1)
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0)

    const { totalDocs } = await payload.count({
      collection: col('reservations'),
      where: { resource: { equals: resource.id }, startTime: { equals: startTime } },
    })
    expect(totalDocs).toBe(1)
  })
})

// The concurrency test above proves retry works (RED evidence for it was a raw
// MongoServerError escaping the handler), but at 6-way concurrency against a
// quantity:1 resource no request ever exhausts the retry budget — every loser
// resolves via a retry that then hits a genuine, non-transient ValidationError.
// So it cannot tell "the 409 branch was deleted" from "the retry was deleted":
// either regression looks the same at that concurrency (a non-5xx response).
//
// These two tests force retry exhaustion directly, with no DB and no race:
// `req.payload.create`/`update` is stubbed to always reject with an error
// shaped exactly like `isTransientWriteConflict` checks for (never stubbing
// that helper itself), so the real retry loop runs, genuinely exhausts, and
// the real 409-mapping branch is what has to fire for these to pass.
const makeTransientWriteConflict = () =>
  Object.assign(new Error('WriteConflict'), {
    code: 112,
    errorLabels: ['TransientTransactionError'],
  })

describe('createBooking — retry exhaustion maps to 409 (deterministic)', () => {
  test('a write that is always a transient conflict returns 409 retryable after exhausting retries', async () => {
    const create = vi.fn().mockRejectedValue(makeTransientWriteConflict())
    const endpoint = createBookingEndpoint(resolved)

    const res = await endpoint.handler({
      json: () =>
        Promise.resolve({
          customer: 'cust-1',
          resource: 'res-1',
          service: 'svc-1',
          startTime: '2027-04-01T10:00:00.000Z',
        }),
      payload: { create },
      user: { id: 'cust-1', collection: 'customers' },
    } as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'That slot is being booked by someone else. Please try again.',
      retryable: true,
    })
    // retryOnWriteConflict's default `attempts` (src/utilities/retryOnWriteConflict.ts).
    // Proves the write was genuinely retried to exhaustion, not failed once and
    // mapped straight to 409 — if the retry call were ever removed this would be 1.
    expect(create).toHaveBeenCalledTimes(5)
  })
})

describe('cancelBooking — retry exhaustion maps to 409 (deterministic)', () => {
  test('a write that is always a transient conflict returns 409 retryable after exhausting retries', async () => {
    const findByID = vi.fn().mockResolvedValue({ id: 'res-1', customer: 'cust-1' })
    const update = vi.fn().mockRejectedValue(makeTransientWriteConflict())
    const endpoint = createCancelBookingEndpoint(resolved)

    const res = await endpoint.handler({
      json: () => Promise.resolve({ reservationId: 'res-1' }),
      payload: { findByID, update },
      user: { id: 'cust-1', collection: 'customers' },
    } as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'That booking is being modified. Please try again.',
      retryable: true,
    })
    // Same reasoning as the create-side test above: proves the update was
    // genuinely retried to exhaustion (default `attempts`), not that the first
    // rejection was mapped straight to 409.
    expect(update).toHaveBeenCalledTimes(5)
  })
})

/**
 * Concurrency harness for the booking write path.
 *
 * These tests exist to answer one question with evidence rather than argument:
 * when N callers book the SAME resource at the SAME time simultaneously, does
 * the plugin's conflict detection hold?
 *
 * `validateConflicts` is a read-then-write — it queries for overlapping
 * reservations, then Payload inserts. Payload wraps `create` in a transaction
 * (payload/dist/collections/operations/create.js:26) and the dev harness runs a
 * MongoMemoryReplSet, so transactions are genuinely active here. But snapshot
 * isolation does not prevent two transactions from each reading "no conflict"
 * and then inserting DIFFERENT documents: MongoDB raises a write conflict only
 * when two transactions touch the SAME document.
 *
 * If that reasoning is right, these tests fail. If they pass, the race is not
 * reachable through this path and no locking machinery is warranted.
 */
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { retryOnWriteConflict } from '../src/utilities/retryOnWriteConflict.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'

/** Unique-per-test fixtures so parallel cases never share a resource. */
async function seed({ quantity = 1, tag }: { quantity?: number; tag: string }) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Concurrency Service ${tag}`, active: true, duration: 60 },
  })

  const resource = await payload.create({
    collection: col('resources'),
    data: {
      name: `Concurrency Resource ${tag}`,
      active: true,
      quantity,
      services: [service.id],
    },
  })

  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `concurrency-${tag}@example.com`,
      firstName: 'Concurrency',
      lastName: tag,
      password: 'test1234',
    },
  })

  return { customer, resource, service }
}

/**
 * Fire `count` creates for the same slot with no await between them, so they
 * interleave at their DB round-trips. Returns how many the API accepted and how
 * many rows actually landed.
 */
async function raceBookings({
  count,
  customerId,
  resourceId,
  serviceId,
  startTime,
}: {
  count: number
  customerId: number | string
  resourceId: number | string
  serviceId: number | string
  startTime: string
}) {
  const attempts = Array.from({ length: count }, () =>
    payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime,
        status: 'pending',
      },
    }),
  )

  const settled = await Promise.allSettled(attempts)
  const accepted = settled.filter((r) => r.status === 'fulfilled').length
  const rejected = settled.filter((r) => r.status === 'rejected').length

  const { totalDocs: persisted } = await payload.count({
    collection: col('reservations'),
    where: { resource: { equals: resourceId }, startTime: { equals: startTime } },
  })

  return { accepted, persisted, rejected, settled }
}

describe('Booking write path under concurrency', () => {
  test('sequential double-booking is rejected (control)', async () => {
    const { customer, resource, service } = await seed({ tag: 'control' })
    const startTime = '2026-09-01T10:00:00.000Z'

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime,
        status: 'pending',
      },
    })

    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime,
          status: 'pending',
        },
      }),
    ).rejects.toThrow()

    const { totalDocs } = await payload.count({
      collection: col('reservations'),
      where: { resource: { equals: resource.id }, startTime: { equals: startTime } },
    })
    expect(totalDocs).toBe(1)
  })

  test('exactly one of 10 concurrent bookings for the same slot survives', async () => {
    const { customer, resource, service } = await seed({ tag: 'race-10' })
    const startTime = '2026-09-02T10:00:00.000Z'

    const { accepted, persisted } = await raceBookings({
      count: 10,
      customerId: customer.id,
      resourceId: resource.id,
      serviceId: service.id,
      startTime,
    })

    expect({ accepted, persisted }).toEqual({ accepted: 1, persisted: 1 })
  })

  test('a resource with quantity 3 never OVERBOOKS under concurrency', async () => {
    const { customer, resource, service } = await seed({ quantity: 3, tag: 'race-capacity' })
    const startTime = '2026-09-03T10:00:00.000Z'

    const { persisted } = await raceBookings({
      count: 8,
      customerId: customer.id,
      resourceId: resource.id,
      serviceId: service.id,
      startTime,
    })

    // Safety only. Without retry the loser of the lock race aborts rather than
    // waiting, so a bare payload.create burst under-books (measured: 1 of 3).
    // That is the correct trade for a direct write — never overbook — and the
    // next test covers recovering the lost capacity.
    expect(persisted).toBeLessThanOrEqual(3)
  })

  test('retrying transient write conflicts recovers the full capacity of 3', async () => {
    const { customer, resource, service } = await seed({ quantity: 3, tag: 'race-retry' })
    const startTime = '2026-09-05T10:00:00.000Z'

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        retryOnWriteConflict(() =>
          payload.create({
            collection: col('reservations'),
            data: {
              customer: customer.id,
              resource: resource.id,
              service: service.id,
              startTime,
              status: 'pending',
            },
          }),
        ),
      ),
    )

    const { totalDocs } = await payload.count({
      collection: col('reservations'),
      where: { resource: { equals: resource.id }, startTime: { equals: startTime } },
    })

    // Exactly 3 — not fewer, proving retry recovers the capacity the bare
    // burst loses, and not more, proving it does not defeat the lock.
    expect(totalDocs).toBe(3)
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
  })

  test('concurrent bookings at OVERLAPPING (not identical) times still yield one', async () => {
    const { customer, resource, service } = await seed({ tag: 'race-overlap' })
    const base = new Date('2026-09-04T10:00:00.000Z').getTime()

    // 60-minute service; each attempt starts 5 minutes after the last, so all
    // six windows mutually overlap. A distinct startTime per attempt also rules
    // out any incidental same-document contention doing the work for us.
    const attempts = Array.from({ length: 6 }, (_, i) =>
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: new Date(base + i * 5 * 60_000).toISOString(),
          status: 'pending',
        },
      }),
    )

    await Promise.allSettled(attempts)

    const { totalDocs } = await payload.count({
      collection: col('reservations'),
      where: {
        resource: { equals: resource.id },
        startTime: { greater_than_equal: new Date(base - 60_000).toISOString() },
      },
    })

    expect(totalDocs).toBe(1)
  })
})

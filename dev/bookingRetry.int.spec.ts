import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
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

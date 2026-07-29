import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { createHoldSlotEndpoint } from '../src/endpoints/holdSlot.js'
import { createReleaseSlotEndpoint } from '../src/endpoints/releaseSlot.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'
const resolved = resolveConfig({
  defaultBufferTime: 10,
  slotHolds: { enabled: true, ttlMinutes: 10 },
})

async function seed(tag: string) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Hold EP Service ${tag}`, active: true, duration: 60 },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Hold EP Resource ${tag}`, active: true, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `holdep-${tag}@example.com`,
      firstName: 'HoldEP',
      lastName: tag,
      password: 'test1234',
    },
  })
  return { customer, resource, service }
}

const call = (endpoint: { handler: unknown }, body: unknown, user: unknown = null) =>
  (endpoint.handler as (r: never) => Promise<Response>)({
    json: () => Promise.resolve(body),
    payload,
    user,
  } as never)

describe('slot-hold endpoints', () => {
  test('POST /reserve/hold returns a token and blocks other bookers', async () => {
    const { customer, resource, service } = await seed('take')
    const startTime = '2027-06-01T10:00:00.000Z'

    const res = await call(createHoldSlotEndpoint(resolved), {
      resource: resource.id,
      service: service.id,
      startTime,
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as { expiresAt: string; token: string }
    expect(typeof body.token).toBe('string')
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // Someone else cannot take the slot. Authenticated as the customer so the
    // request actually reaches the availability check instead of being turned
    // away earlier by the endpoint's unrelated anonymous-customer guard —
    // calling `endpoint.handler` directly (as here) bypasses Payload's own HTTP
    // dispatch, which is what normally converts a thrown ValidationError into a
    // Response carrying its own `.status` (see dev/bookingRetry.int.spec.ts).
    let blockedStatus: number
    try {
      const blocked = await call(
        createBookingEndpoint(resolved),
        {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime,
        },
        { id: customer.id, collection: 'customers' },
      )
      blockedStatus = blocked.status
    } catch (err) {
      blockedStatus = (err as { status?: number }).status ?? 500
    }
    expect(blockedStatus).toBeGreaterThanOrEqual(400)
  })

  test('a booking presenting the holdToken succeeds', async () => {
    const { customer, resource, service } = await seed('consume')
    const startTime = '2027-06-02T10:00:00.000Z'

    const held = await call(createHoldSlotEndpoint(resolved), {
      resource: resource.id,
      service: service.id,
      startTime,
    })
    const { token } = (await held.json()) as { token: string }

    // Authenticated as the customer themselves — matches how the endpoint is
    // actually reached (an anonymous caller may not set `customer`; that guard
    // is unrelated to holds and covered separately in dev/int.spec.ts).
    const booked = await call(
      createBookingEndpoint(resolved),
      {
        customer: customer.id,
        holdToken: token,
        resource: resource.id,
        service: service.id,
        startTime,
      },
      { id: customer.id, collection: 'customers' },
    )
    expect(booked.status).toBe(201)

    // The hold is consumed, not left behind to block the next booking.
    const { totalDocs } = await payload.count({
      collection: col('reservation-holds'),
      where: { token: { equals: token } },
    })
    expect(totalDocs).toBe(0)
  })

  test('POST /reserve/hold/release frees the slot and is idempotent', async () => {
    const { resource, service } = await seed('release')
    const held = await call(createHoldSlotEndpoint(resolved), {
      resource: resource.id,
      service: service.id,
      startTime: '2027-06-03T10:00:00.000Z',
    })
    const { token } = (await held.json()) as { token: string }

    const first = await call(createReleaseSlotEndpoint(resolved), { token })
    expect(first.status).toBe(200)
    expect((await first.json()) as { released: number }).toEqual({ released: 1 })

    const second = await call(createReleaseSlotEndpoint(resolved), { token })
    expect(second.status).toBe(200)
    expect((await second.json()) as { released: number }).toEqual({ released: 0 })
  })

  test('a hold request for an already-booked slot is refused', async () => {
    const { customer, resource, service } = await seed('taken')
    const startTime = '2027-06-04T10:00:00.000Z'

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

    const res = await call(createHoldSlotEndpoint(resolved), {
      resource: resource.id,
      service: service.id,
      startTime,
    })
    expect(res.status).toBe(409)
  })
})

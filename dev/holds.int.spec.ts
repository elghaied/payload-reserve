/**
 * Slot-hold harness.
 *
 * A hold is only worth having if it actually blocks other bookers, releases
 * cleanly, stops blocking once expired, and cannot be taken twice for the same
 * slot. Each of those is a separate test here, and the concurrency one is the
 * reason holds had to wait for the booking lock to land first.
 */
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { releaseHold, takeHold } from '../src/services/HoldService.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'

/**
 * Must mirror the dev app's plugin options — notably `defaultBufferTime`, or a
 * hold would reserve a narrower window than the booking it protects.
 */
const resolved = resolveConfig({
  defaultBufferTime: 10,
  slotHolds: { enabled: true, ttlMinutes: 10 },
})

async function seed(tag: string, quantity = 1) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Hold Service ${tag}`, active: true, duration: 60 },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Hold Resource ${tag}`, active: true, quantity, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `hold-${tag}@example.com`,
      firstName: 'Hold',
      lastName: tag,
      password: 'test1234',
    },
  })
  return { customer, resource, service }
}

const reqFor = () => ({ payload, user: null }) as unknown as Parameters<typeof takeHold>[0]['req']

function bookingData(
  ids: { customer: number | string; resource: number | string; service: number | string },
  startTime: string,
) {
  return {
    customer: ids.customer,
    resource: ids.resource,
    service: ids.service,
    startTime,
    status: 'pending',
  }
}

describe('Slot holds', () => {
  test('an active hold blocks another customer from booking the slot', async () => {
    const { customer, resource, service } = await seed('blocks')
    const startTime = '2027-01-04T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    expect(held.ok).toBe(true)

    await expect(
      payload.create({
        collection: col('reservations'),
        data: bookingData(
          { customer: customer.id, resource: resource.id, service: service.id },
          startTime,
        ),
      }),
    ).rejects.toThrow()
  })

  test('the holder converts their own hold into a booking', async () => {
    const { customer, resource, service } = await seed('convert')
    const startTime = '2027-01-05T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    // Same slot, but presenting the hold's token — the hold must not block the
    // booking it exists to protect.
    const booking = await payload.create({
      collection: col('reservations'),
      context: { holdToken: held.hold.token },
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })

    expect(booking.id).toBeDefined()
  })

  test('releasing a hold frees the slot immediately', async () => {
    const { customer, resource, service } = await seed('release')
    const startTime = '2027-01-06T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    const { released } = await releaseHold({
      config: resolved,
      req: reqFor(),
      token: held.hold.token,
    })
    expect(released).toBe(1)

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('an EXPIRED hold does not block the slot', async () => {
    const { customer, resource, service } = await seed('expired')
    const startTime = '2027-01-07T10:00:00.000Z'

    // Written directly with an expiry in the past — the read-time predicate,
    // not a sweep, is what must ignore it.
    await payload.create({
      collection: col('reservation-holds'),
      data: {
        endTime: '2027-01-07T11:00:00.000Z',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        guestCount: 1,
        resource: resource.id,
        service: service.id,
        startTime,
        token: 'expired-token-fixture',
      },
    })

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('a hold does not block a DIFFERENT, non-overlapping slot', async () => {
    const { customer, resource, service } = await seed('adjacent')

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date('2027-01-08T10:00:00.000Z'),
    })
    expect(held.ok).toBe(true)

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        '2027-01-08T14:00:00.000Z',
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('only ONE of 8 concurrent holds for the same slot succeeds', async () => {
    const { resource, service } = await seed('race')
    const startTime = new Date('2027-01-09T10:00:00.000Z')

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        takeHold({
          config: resolved,
          req: reqFor(),
          resourceId: resource.id,
          serviceId: service.id,
          startTime,
        }),
      ),
    )

    const granted = settled.filter(
      (r) => r.status === 'fulfilled' && r.value.ok === true,
    ).length

    const { totalDocs } = await payload.count({
      collection: col('reservation-holds'),
      where: { resource: { equals: resource.id } },
    })

    // This is the test holds exist for. Without the booking lock underneath,
    // all 8 callers would read "free" before any of them wrote, and all 8 would
    // be told they hold the slot.
    expect({ granted, totalDocs }).toEqual({ granted: 1, totalDocs: 1 })
  })
})

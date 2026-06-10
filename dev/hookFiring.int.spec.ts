import type { Payload } from 'payload'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import {
  buildHooksPayload,
  countingHooks,
  hookCalls,
  resetHookCalls,
} from './helpers/hooksPayload.js'

let payload: Payload
let stop: () => Promise<void>
let serviceId: number | string
let resourceId: number | string
let customerId: number | string

const col = (slug: string) => slug as 'users'
const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

beforeAll(async () => {
  const built = await buildHooksPayload()
  payload = built.payload
  stop = built.stop

  const service = await payload.create({
    collection: col('services'),
    data: {
      name: 'Hook Service',
      active: true,
      bufferTimeAfter: 0,
      bufferTimeBefore: 0,
      duration: 60,
    },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: 'Hook Resource', active: true, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: 'hooks@example.com',
      firstName: 'Hook',
      lastName: 'Tester',
      password: 'testpass123',
    },
  })
  serviceId = service.id
  resourceId = resource.id
  customerId = customer.id
}, 120_000)

afterAll(async () => {
  await stop()
})

beforeEach(() => {
  resetHookCalls()
})

describe('Plugin hook firing (review A6/A7/A8/A15)', () => {
  test('beforeBookingCreate fires exactly once per /api/reserve/book booking (A6)', async () => {
    const ep = createBookingEndpoint(resolveConfig({ hooks: countingHooks }))
    const req = {
      json: () =>
        Promise.resolve({
          customer: customerId,
          resource: resourceId,
          service: serviceId,
          startTime: future(48),
          status: 'pending',
        }),
      payload,
      t: (k: string) => k,
      // Staff user: anonymous callers may no longer set `customer` (review B3)
      user: { id: 'admin-1', collection: 'users' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    const json = (await resp.json()) as Record<string, unknown>

    expect(json.id).toBeDefined()
    expect(hookCalls.beforeBookingCreate).toBe(1)
  })

  test('afterStatusChange does NOT fire on create, fires once on a real transition (A7)', async () => {
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: future(72),
        status: 'pending',
      },
    })
    expect(hookCalls.afterStatusChange).toHaveLength(0)

    await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { status: 'confirmed' },
    })
    expect(hookCalls.afterStatusChange).toEqual([
      { newStatus: 'confirmed', previousStatus: 'pending' },
    ])
  })

  test('afterBookingCreate respects context.skipReservationHooks (A15)', async () => {
    await payload.create({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: customerId,
        endTime: future(97),
        resource: resourceId,
        service: serviceId,
        startTime: future(96),
        status: 'pending',
      },
    })
    expect(hookCalls.afterBookingCreate).toBe(0)

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: future(120),
        status: 'pending',
      },
    })
    expect(hookCalls.afterBookingCreate).toBe(1)
  })

  test('beforeBookingCancel does NOT fire when the notice period rejects the cancel (A8)', async () => {
    // Inside the default 24h notice window
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: future(2),
        status: 'pending',
      },
    })

    await expect(
      payload.update({
        id: reservation.id,
        collection: col('reservations'),
        data: { status: 'cancelled' },
      }),
    ).rejects.toThrow()
    expect(hookCalls.beforeBookingCancel).toBe(0)
  })

  test('beforeBookingCancel still fires once for a permitted cancel (A8 control)', async () => {
    // Well outside the notice window
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: future(144),
        status: 'pending',
      },
    })

    const cancelled = await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { status: 'cancelled' },
    })
    expect(cancelled.status).toBe('cancelled')
    expect(hookCalls.beforeBookingCancel).toBe(1)
  })
})

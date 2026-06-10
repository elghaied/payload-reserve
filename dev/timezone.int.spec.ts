import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getAvailableSlots } from '../src/services/AvailabilityService.js'
import { buildTimezonePayload } from './helpers/timezonePayload.js'

let payload: Payload
let stop: () => Promise<void>

const col = (slug: string) => slug as 'users'

beforeAll(async () => {
  const built = await buildTimezonePayload()
  payload = built.payload
  stop = built.stop
}, 120_000)

afterAll(async () => {
  await stop()
})

describe('Business timezone (Europe/Paris) — schedule resolution', () => {
  test('wed 09:00-17:00 schedule yields 07:00Z-15:00Z slots in summer', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'TZ Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'TZ Resource', active: true, services: [service.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'TZ Schedule',
        active: true,
        recurringSlots: [{ day: 'wed', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })

    // 2026-06-10 is a Wednesday; Paris is UTC+2 in June.
    const slots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: '2026-06-10',
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
      timeZone: 'Europe/Paris',
    })

    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.toISOString()).toBe('2026-06-10T07:00:00.000Z')
    const last = slots[slots.length - 1]
    expect(last.end.toISOString()).toBe('2026-06-10T15:00:00.000Z')
  })

  test('an exception blocks exactly the Paris calendar day', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'TZ Exc Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'TZ Exc Resource', active: true, services: [service.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'TZ Exc Schedule',
        active: true,
        exceptions: [{ date: '2026-06-17T00:00:00.000Z' }],
        recurringSlots: [{ day: 'wed', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })

    const base = {
      blockingStatuses: ['pending', 'confirmed'],
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
      timeZone: 'Europe/Paris',
    }

    const blocked = await getAvailableSlots({ ...base, date: '2026-06-17' })
    expect(blocked).toHaveLength(0)

    const open = await getAvailableSlots({ ...base, date: '2026-06-24' })
    expect(open.length).toBeGreaterThan(0)
  })

  test('full-day booking ends at Paris end-of-day', async () => {
    const service = await payload.create({
      collection: col('services'),
      // duration: 1 — field has min: 1; for full-day the value is unused by computeEndTime
      data: { name: 'TZ Full Day', active: true, duration: 1, durationType: 'full-day' },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'TZ Full Day Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'tz-fullday@example.com',
        firstName: 'TZ',
        lastName: 'FullDay',
        password: 'testpass123',
      },
    })

    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2026-06-10T08:00:00.000Z',
        status: 'pending',
      },
    })

    // Paris end of June 10 = 21:59:59.999Z (UTC+2)
    expect(new Date(reservation.endTime as string).toISOString()).toBe(
      '2026-06-10T21:59:59.999Z',
    )
  })
})

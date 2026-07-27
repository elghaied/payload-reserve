import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getAvailableSlots } from '../src/services/AvailabilityService.js'
import { resolveScheduleForDate } from '../src/utilities/scheduleUtils.js'
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
    const { slots } = await getAvailableSlots({
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

    const { slots: blocked } = await getAvailableSlots({ ...base, date: '2026-06-17' })
    expect(blocked).toHaveLength(0)

    const { slots: open } = await getAvailableSlots({ ...base, date: '2026-06-24' })
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

  test('resource-availability grid keys days and time-off in Paris', async () => {
    const { buildResourceAvailability } = await import('../src/endpoints/resourceAvailability.js')

    const service = await payload.create({
      collection: col('services'),
      data: { name: 'TZ Grid Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'TZ Grid Resource', active: true, services: [service.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'TZ Grid Schedule',
        active: true,
        exceptions: [{ date: '2026-07-01T00:00:00.000Z' }],
        recurringSlots: [{ day: 'wed', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })

    const result = await buildResourceAvailability({
      blockingStatuses: ['pending', 'confirmed'],
      end: new Date('2026-07-02T00:00:00.000Z'),
      payload,
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      start: new Date('2026-06-29T00:00:00.000Z'),
      timeZone: 'Europe/Paris',
    })

    const keys = result.days.map((d) => d.date)
    expect(keys).toContain('2026-07-01')

    // July 1 2026 is a Wednesday AND an exception: no shift windows, time-off covers the Paris day
    const july1 = result.days.find((d) => d.date === '2026-07-01')!
    expect(july1.shiftWindows).toHaveLength(0)
    expect(july1.timeOff.length).toBeGreaterThan(0)
    // Paris midnight July 1 = 22:00Z June 30
    expect(july1.timeOff[0].start).toBe('2026-06-30T22:00:00.000Z')

    // June 30 (Tuesday, not exception): no shift windows but also NOT time-off
    const june30 = result.days.find((d) => d.date === '2026-06-30')!
    expect(june30.timeOff).toHaveLength(0)
  })
})

describe('exception instants are interpreted in the business timezone (documented semantics)', () => {
  // A schedule with a tue recurring slot so the exception's effect on Tuesday is observable.
  // The exception instant 2026-06-17T00:00Z is June 16, 20:00 in New York (Tuesday).
  const schedule = {
    exceptions: [{ date: '2026-06-17T00:00:00.000Z' }],
    recurringSlots: [
      { day: 'tue' as const, endTime: '17:00', startTime: '09:00' },
      { day: 'wed' as const, endTime: '17:00', startTime: '09:00' },
    ],
    scheduleType: 'recurring' as const,
  }

  test('UTC-midnight instant keys to the prior day in negative-offset zones', () => {
    // 2026-06-17T00:00Z is June 16, 20:00 in New York — so the exception
    // blocks Tuesday June 16, NOT Wednesday June 17. Interim semantics until
    // the admin picker normalizes what it stores (task #9 territory).
    expect(resolveScheduleForDate(schedule, '2026-06-16', 'America/New_York')).toHaveLength(0)
    expect(
      resolveScheduleForDate(schedule, '2026-06-17', 'America/New_York').length,
    ).toBeGreaterThan(0)
  })

  test('UTC-midnight instant stays on the same day in non-negative-offset zones', () => {
    expect(resolveScheduleForDate(schedule, '2026-06-17', 'Europe/Paris')).toHaveLength(0)
    expect(resolveScheduleForDate(schedule, '2026-06-17', 'UTC')).toHaveLength(0)
  })
})

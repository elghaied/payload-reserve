import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAvailableSlots } from '../src/services/AvailabilityService.js'
import { buildAvailabilityReasonPayload } from './helpers/availabilityReasonPayload.js'

/**
 * `getAvailableSlots({ excludeReservationId })` — the read path's counterpart to
 * the `excludeReservationId` `checkAvailability` has always taken.
 *
 * A reschedule UI (or an agent tool) asks "which starts are on offer for this
 * booking's new time?" and the honest answer must not count the booking being
 * moved as occupancy: a 09:00–11:00 booking asked to move to 10:00 is refused
 * by a generator that sees itself sitting on 10:00. Without this parameter no
 * move shorter than the service duration can ever be offered.
 */

let payload: Payload
let stop: () => Promise<void>

const col = (slug: string) => slug as 'users'

const MONDAY = '2030-04-08'

let serviceId: string
let resourceId: string
let ownId: string
let otherId: string
let base: Parameters<typeof getAvailableSlots>[0]

const starts = (r: { slots: Array<{ start: Date }> }) =>
  r.slots.map((s) => s.start.toISOString())

beforeAll(async () => {
  const built = await buildAvailabilityReasonPayload('availabilityexcludememory')
  payload = built.payload
  stop = built.stop

  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: 'availability-exclude@example.com',
      firstName: 'Exclude',
      lastName: 'Tester',
      password: 'testpass123',
    },
  })

  const service = await payload.create({
    collection: col('services'),
    data: { name: 'EX Service', active: true, duration: 120, durationType: 'fixed' },
  })
  serviceId = service.id

  const resource = await payload.create({
    collection: col('resources'),
    data: { name: 'EX Resource', active: true, services: [serviceId] },
  })
  resourceId = resource.id
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'EX Schedule',
      active: true,
      recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
      resource: resourceId,
      scheduleType: 'recurring',
    },
  })

  // The booking being moved: 09:00–11:00.
  const own = await payload.create({
    collection: col('reservations'),
    data: {
      customer: customer.id,
      resource: resourceId,
      service: serviceId,
      startTime: `${MONDAY}T09:00:00.000Z`,
      status: 'pending',
    },
  })
  ownId = own.id

  // Somebody else's: 13:00–15:00. Must stay blocked whatever we exclude.
  const other = await payload.create({
    collection: col('reservations'),
    data: {
      customer: customer.id,
      resource: resourceId,
      service: serviceId,
      startTime: `${MONDAY}T13:00:00.000Z`,
      status: 'pending',
    },
  })
  otherId = other.id

  base = {
    blockingStatuses: ['pending', 'confirmed'],
    date: MONDAY,
    payload,
    req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
    reservationSlug: 'reservations',
    resourceIds: [resourceId],
    resourceSlug: 'resources',
    scheduleSlug: 'schedules',
    serviceId,
    serviceSlug: 'services',
  }
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('getAvailableSlots - excludeReservationId', () => {
  it('counts every blocking reservation when nothing is excluded', async () => {
    const r = await getAvailableSlots(base)
    expect(starts(r)).not.toContain(`${MONDAY}T10:00:00.000Z`)
    expect(starts(r)).toContain(`${MONDAY}T11:00:00.000Z`)
  })

  it('offers the starts inside the excluded reservation\'s own window', async () => {
    const r = await getAvailableSlots({ ...base, excludeReservationId: ownId })
    expect(starts(r)).toContain(`${MONDAY}T09:00:00.000Z`)
    expect(starts(r)).toContain(`${MONDAY}T10:00:00.000Z`)
  })

  it('keeps other reservations blocking while one is excluded', async () => {
    const r = await getAvailableSlots({ ...base, excludeReservationId: ownId })
    expect(starts(r)).not.toContain(`${MONDAY}T13:00:00.000Z`)
    expect(starts(r)).not.toContain(`${MONDAY}T14:00:00.000Z`)
    expect(otherId).toBeDefined()
  })
})

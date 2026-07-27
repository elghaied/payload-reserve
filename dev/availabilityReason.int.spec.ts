import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getAvailableSlots } from '../src/services/AvailabilityService.js'
import { buildAvailabilityReasonPayload } from './helpers/availabilityReasonPayload.js'

let payload: Payload
let stop: () => Promise<void>

const col = (slug: string) => slug as 'users'

// A Monday far in the future — day-key string, TZ-independent (dev config has no
// `timezone` set → defaults to UTC).
const MONDAY = '2030-04-08'

let customerId: string
let serviceId: string
let inactiveServiceId: string
let resourceId: string
let inactiveResourceId: string
let noScheduleResourceId: string
let morningOnlyId: string
let eveningOnlyId: string
let fullyBookedResourceId: string

let base: Parameters<typeof getAvailableSlots>[0]

beforeAll(async () => {
  const built = await buildAvailabilityReasonPayload()
  payload = built.payload
  stop = built.stop

  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: 'availability-reason@example.com',
      firstName: 'Reason',
      lastName: 'Tester',
      password: 'testpass123',
    },
  })
  customerId = customer.id

  const service = await payload.create({
    collection: col('services'),
    data: { name: 'AR Service', active: true, duration: 60, durationType: 'fixed' },
  })
  serviceId = service.id

  const inactiveService = await payload.create({
    collection: col('services'),
    data: { name: 'AR Inactive Service', active: false, duration: 60, durationType: 'fixed' },
  })
  inactiveServiceId = inactiveService.id

  const resource = await payload.create({
    collection: col('resources'),
    data: { name: 'AR Resource', active: true, services: [serviceId] },
  })
  resourceId = resource.id
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'AR Schedule',
      active: true,
      recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
      resource: resourceId,
      scheduleType: 'recurring',
    },
  })

  const inactiveResource = await payload.create({
    collection: col('resources'),
    data: { name: 'AR Inactive Resource', active: false, services: [serviceId] },
  })
  inactiveResourceId = inactiveResource.id

  const noScheduleResource = await payload.create({
    collection: col('resources'),
    data: { name: 'AR No Schedule Resource', active: true, services: [serviceId] },
  })
  noScheduleResourceId = noScheduleResource.id

  const morningOnly = await payload.create({
    collection: col('resources'),
    data: { name: 'AR Morning Only', active: true, services: [serviceId] },
  })
  morningOnlyId = morningOnly.id
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'AR Morning Schedule',
      active: true,
      recurringSlots: [{ day: 'mon', endTime: '10:00', startTime: '09:00' }],
      resource: morningOnlyId,
      scheduleType: 'recurring',
    },
  })

  const eveningOnly = await payload.create({
    collection: col('resources'),
    data: { name: 'AR Evening Only', active: true, services: [serviceId] },
  })
  eveningOnlyId = eveningOnly.id
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'AR Evening Schedule',
      active: true,
      recurringSlots: [{ day: 'mon', endTime: '18:00', startTime: '15:00' }],
      resource: eveningOnlyId,
      scheduleType: 'recurring',
    },
  })

  const fullyBookedResource = await payload.create({
    collection: col('resources'),
    data: { name: 'AR Fully Booked Resource', active: true, services: [serviceId] },
  })
  fullyBookedResourceId = fullyBookedResource.id
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'AR Fully Booked Schedule',
      active: true,
      recurringSlots: [{ day: 'mon', endTime: '10:00', startTime: '09:00' }],
      resource: fullyBookedResourceId,
      scheduleType: 'recurring',
    },
  })
  // The resource's only 60-min candidate slot (09:00-10:00) - book it solid.
  await payload.create({
    collection: col('reservations'),
    data: {
      customer: customerId,
      resource: fullyBookedResourceId,
      service: serviceId,
      startTime: `${MONDAY}T09:00:00.000Z`,
      status: 'pending',
    },
  })

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

describe('getAvailableSlots - EmptyReason', () => {
  it('reports no_resource_ids when no resource is given', async () => {
    const r = await getAvailableSlots({ ...base, resourceIds: [] })
    expect(r).toEqual({ reason: 'no_resource_ids', slots: [] })
  })

  it('reports service_inactive', async () => {
    const r = await getAvailableSlots({ ...base, serviceId: inactiveServiceId })
    expect(r.reason).toBe('service_inactive')
    expect(r.slots).toEqual([])
  })

  it('reports resource_inactive', async () => {
    const r = await getAvailableSlots({ ...base, resourceIds: [inactiveResourceId] })
    expect(r.reason).toBe('resource_inactive')
    expect(r.slots).toEqual([])
  })

  it('reports no_windows when the resource has no active schedule', async () => {
    const r = await getAvailableSlots({ ...base, resourceIds: [noScheduleResourceId] })
    expect(r.reason).toBe('no_windows')
    expect(r.slots).toEqual([])
  })

  it('reports empty_intersection when two resources never overlap', async () => {
    const r = await getAvailableSlots({ ...base, resourceIds: [morningOnlyId, eveningOnlyId] })
    expect(r.reason).toBe('empty_intersection')
    expect(r.slots).toEqual([])
  })

  it('reports all_slots_taken when the day is fully booked', async () => {
    const r = await getAvailableSlots({ ...base, resourceIds: [fullyBookedResourceId] })
    expect(r).toEqual({ reason: 'all_slots_taken', slots: [] })
  })

  // Both `return availableSlots` sites (full-day and general) need the same
  // all_slots_taken treatment — this covers the full-day branch specifically.
  it('reports all_slots_taken for a fully booked full-day service', async () => {
    const fullDayService = await payload.create({
      collection: col('services'),
      data: { name: 'AR Full Day Service', active: true, duration: 1, durationType: 'full-day' },
    })
    const fullDayResource = await payload.create({
      collection: col('resources'),
      data: { name: 'AR Full Day Resource', active: true, services: [fullDayService.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'AR Full Day Schedule',
        active: true,
        recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
        resource: fullDayResource.id,
        scheduleType: 'recurring',
      },
    })
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: fullDayResource.id,
        service: fullDayService.id,
        startTime: `${MONDAY}T09:00:00.000Z`,
        status: 'pending',
      },
    })

    const r = await getAvailableSlots({
      ...base,
      resourceIds: [fullDayResource.id],
      serviceId: fullDayService.id,
    })
    expect(r).toEqual({ reason: 'all_slots_taken', slots: [] })
  })

  it('omits reason when slots are returned', async () => {
    const r = await getAvailableSlots(base)
    expect(r.slots.length).toBeGreaterThan(0)
    expect(r.reason).toBeUndefined()
  })

  it('still returns slots for an inactive service when enforceActive is false', async () => {
    const r = await getAvailableSlots({
      ...base,
      enforceActive: false,
      serviceId: inactiveServiceId,
    })
    expect(r.slots.length).toBeGreaterThan(0)
  })
})

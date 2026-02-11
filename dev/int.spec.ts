import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

// Helper to cast dynamic collection slugs
const col = (slug: string) => slug as 'users'

describe('Reservation plugin - Collections', () => {
  test('all 5 collections are registered', () => {
    expect(payload.collections['reservation-services']).toBeDefined()
    expect(payload.collections['reservation-resources']).toBeDefined()
    expect(payload.collections['reservation-schedules']).toBeDefined()
    expect(payload.collections['reservation-customers']).toBeDefined()
    expect(payload.collections['reservations']).toBeDefined()
  })

  test('can create a service', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: {
        name: 'Test Service',
        active: true,
        duration: 60,
        price: 50,
      },
    })
    expect(service.name).toBe('Test Service')
    expect(service.duration).toBe(60)
  })

  test('can create a resource with service relationship', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'Linked Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: {
        name: 'Test Resource',
        active: true,
        services: [service.id],
      },
    })
    expect(resource.name).toBe('Test Resource')
  })

  test('can create a schedule', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'Schedule Test Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Schedule Test Resource', active: true, services: [service.id] },
    })
    const schedule = await payload.create({
      collection: col('reservation-schedules'),
      data: {
        name: 'Weekday Schedule',
        active: true,
        recurringSlots: [
          { day: 'mon', endTime: '17:00', startTime: '09:00' },
        ],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    expect(schedule.name).toBe('Weekday Schedule')
  })

  test('can create a customer', async () => {
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: {
        name: 'Test Customer',
        email: 'test-unique@example.com',
        phone: '555-1234',
      },
    })
    expect(customer.name).toBe('Test Customer')
    expect(customer.email).toBe('test-unique@example.com')
  })
})

describe('Reservation plugin - calculateEndTime hook', () => {
  test('auto-calculates endTime from startTime + service duration', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'EndTime Service', active: true, duration: 45 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'EndTime Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'EndTime Customer', email: 'endtime@example.com' },
    })

    const startTime = new Date('2025-06-15T10:00:00.000Z')
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: startTime.toISOString(),
        status: 'pending',
      },
    })

    const endTime = new Date(reservation.endTime as string)
    const expectedEnd = new Date('2025-06-15T10:45:00.000Z')
    expect(endTime.getTime()).toBe(expectedEnd.getTime())
  })
})

describe('Reservation plugin - validateConflicts hook', () => {
  test('prevents double-booking on same resource', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: {
        name: 'Conflict Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Conflict Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'Conflict Customer', email: 'conflict@example.com' },
    })

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-07-01T10:00:00.000Z',
        status: 'pending',
      },
    })

    // Overlapping reservation should fail
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2025-07-01T10:30:00.000Z',
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })

  test('allows booking on different resource at same time', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: {
        name: 'No Conflict Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource1 = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Resource A', active: true, services: [service.id] },
    })
    const resource2 = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Resource B', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'No Conflict Customer', email: 'noconflict@example.com' },
    })

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource1.id,
        service: service.id,
        startTime: '2025-07-02T10:00:00.000Z',
        status: 'pending',
      },
    })

    // Same time but different resource should succeed
    const res2 = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource2.id,
        service: service.id,
        startTime: '2025-07-02T10:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res2.id).toBeDefined()
  })
})

describe('Reservation plugin - validateStatusTransition hook', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'Status Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Status Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'Status Customer', email: 'status@example.com' },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  test('new reservations must start as pending', async () => {
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          resource: resourceId,
          service: serviceId,
          startTime: '2025-08-01T10:00:00.000Z',
          status: 'confirmed',
        },
      }),
    ).rejects.toThrow()
  })

  test('allows pending -> confirmed transition', async () => {
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: '2025-08-02T10:00:00.000Z',
        status: 'pending',
      },
    })

    const updated = await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { status: 'confirmed' },
    })
    expect(updated.status).toBe('confirmed')
  })

  test('rejects completed -> pending transition', async () => {
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: '2025-08-03T10:00:00.000Z',
        status: 'pending',
      },
    })

    // pending -> confirmed -> completed
    await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { status: 'confirmed' },
    })
    await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { status: 'completed' },
    })

    // completed -> pending should fail
    await expect(
      payload.update({
        id: reservation.id,
        collection: col('reservations'),
        data: { status: 'pending' },
      }),
    ).rejects.toThrow()
  })
})

describe('Reservation plugin - validateCancellation hook', () => {
  test('rejects cancellation within notice period', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'Cancel Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Cancel Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'Cancel Customer', email: 'cancel@example.com' },
    })

    // Create a reservation starting in 1 hour (less than 24h notice)
    const soonStart = new Date(Date.now() + 60 * 60 * 1000)
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: soonStart.toISOString(),
        status: 'pending',
      },
    })

    // Try to cancel - should fail due to 24h notice period
    await expect(
      payload.update({
        id: reservation.id,
        collection: col('reservations'),
        data: { status: 'cancelled' },
      }),
    ).rejects.toThrow()
  })

  test('allows cancellation with sufficient notice', async () => {
    const service = await payload.create({
      collection: col('reservation-services'),
      data: { name: 'Cancel OK Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('reservation-resources'),
      data: { name: 'Cancel OK Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('reservation-customers'),
      data: { name: 'Cancel OK Customer', email: 'cancelok@example.com' },
    })

    // Create a reservation 48 hours from now (more than 24h notice)
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: futureStart.toISOString(),
        status: 'pending',
      },
    })

    const updated = await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { cancellationReason: 'Changed plans', status: 'cancelled' },
    })
    expect(updated.status).toBe('cancelled')
  })
})

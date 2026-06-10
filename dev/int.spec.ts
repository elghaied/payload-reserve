import type { Access, Field, Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createCancelBookingEndpoint } from '../src/endpoints/cancelBooking.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { validateGuestBooking } from '../src/hooks/reservations/validateGuestBooking.js'
import { resolveGuestBookingAllowed } from '../src/utilities/guestBooking.js'

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
  test('all 5 plugin collections are registered', () => {
    expect(payload.collections['services']).toBeDefined()
    expect(payload.collections['resources']).toBeDefined()
    expect(payload.collections['schedules']).toBeDefined()
    expect(payload.collections['reservations']).toBeDefined()
    expect(payload.collections['customers']).toBeDefined()
  })

  test('customers collection has auth enabled', () => {
    const customersConfig = payload.config.collections.find((c) => c.slug === 'customers')
    expect(customersConfig).toBeDefined()
    expect(customersConfig!.auth).toBeTruthy()
  })

  test('customers collection blocks admin panel access', () => {
    const customersConfig = payload.config.collections.find((c) => c.slug === 'customers')
    expect(customersConfig).toBeDefined()
    expect(customersConfig!.access?.admin).toBeDefined()
    // The access.admin function should return false
    const result = customersConfig!.access.admin({} as Parameters<NonNullable<NonNullable<typeof customersConfig>['access']>['admin']>[0])
    expect(result).toBe(false)
  })

  test('users collection is NOT modified by the plugin', () => {
    const usersConfig = payload.config.collections.find((c) => c.slug === 'users')
    expect(usersConfig).toBeDefined()
    const fieldNames = usersConfig!.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    // Plugin should NOT inject phone, notes, or bookings into users
    expect(fieldNames).not.toContain('phone')
    expect(fieldNames).not.toContain('notes')
    expect(fieldNames).not.toContain('bookings')
  })

  test('can create a service', async () => {
    const service = await payload.create({
      collection: col('services'),
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
      collection: col('services'),
      data: { name: 'Linked Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
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
      collection: col('services'),
      data: { name: 'Schedule Test Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Schedule Test Resource', active: true, services: [service.id] },
    })
    const schedule = await payload.create({
      collection: col('schedules'),
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

  test('can create a customer with firstName, lastName, and auth', async () => {
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'test-unique@example.com',
        firstName: 'Test',
        lastName: 'Customer',
        password: 'testpass123',
        phone: '555-1234',
      },
    })
    expect(customer.firstName).toBe('Test')
    expect(customer.lastName).toBe('Customer')
    expect(customer.email).toBe('test-unique@example.com')
  })
})

describe('Reservation plugin - calculateEndTime hook', () => {
  test('auto-calculates endTime from startTime + service duration', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'EndTime Service', active: true, duration: 45 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'EndTime Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'endtime@example.com', firstName: 'EndTime', lastName: 'Customer', password: 'testpass123' },
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
      collection: col('services'),
      data: {
        name: 'Conflict Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Conflict Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'conflict@example.com', firstName: 'Conflict', lastName: 'Customer', password: 'testpass123' },
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
      collection: col('services'),
      data: {
        name: 'No Conflict Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource1 = await payload.create({
      collection: col('resources'),
      data: { name: 'Resource A', active: true, services: [service.id] },
    })
    const resource2 = await payload.create({
      collection: col('resources'),
      data: { name: 'Resource B', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'noconflict@example.com', firstName: 'No Conflict', lastName: 'Customer', password: 'testpass123' },
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
      collection: col('services'),
      data: { name: 'Status Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Status Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'status@example.com', firstName: 'Status', lastName: 'Customer', password: 'testpass123' },
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

  test('admin user can create reservation as confirmed', async () => {
    const { docs: users } = await payload.find({
      collection: 'users',
      where: { email: { equals: 'dev@payloadcms.com' } },
    })
    const adminUser = users[0]

    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: '2025-08-10T10:00:00.000Z',
        status: 'confirmed',
      },
      user: adminUser,
    })
    expect(reservation.status).toBe('confirmed')
  })

  test('admin user cannot create reservation as completed', async () => {
    const { docs: users } = await payload.find({
      collection: 'users',
      where: { email: { equals: 'dev@payloadcms.com' } },
    })
    const adminUser = users[0]

    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          resource: resourceId,
          service: serviceId,
          startTime: '2025-08-11T10:00:00.000Z',
          status: 'completed',
        },
        user: adminUser,
      }),
    ).rejects.toThrow()
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
      collection: col('services'),
      data: { name: 'Cancel Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Cancel Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'cancel@example.com', firstName: 'Cancel', lastName: 'Customer', password: 'testpass123' },
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
      collection: col('services'),
      data: { name: 'Cancel OK Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Cancel OK Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'cancelok@example.com', firstName: 'Cancel OK', lastName: 'Customer', password: 'testpass123' },
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

// ---------------------------------------------------------------------------
// Inventory mode: quantity > 1, capacityMode: 'per-reservation'
// Each overlapping reservation consumes one unit. When all units are taken the
// next booking must be rejected.
// ---------------------------------------------------------------------------
describe('Reservation plugin - inventory mode (per-reservation quantity)', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  // Use a unique time window far in the future so these tests do not conflict
  // with other suites that share the same in-memory DB.
  const BASE_TIME = '2030-01-10T09:00:00.000Z'

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Inventory Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    // quantity: 3 means three concurrent reservations are allowed
    const resource = await payload.create({
      collection: col('resources'),
      data: {
        name: 'Inventory Resource (qty=3)',
        active: true,
        capacityMode: 'per-reservation',
        quantity: 3,
        services: [service.id],
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'inventory@example.com',
        firstName: 'Inventory',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('allows the first reservation when resource has capacity', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: BASE_TIME,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
  })

  it('allows a second overlapping reservation (unit 2 of 3)', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: BASE_TIME,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
  })

  it('allows a third overlapping reservation (unit 3 of 3)', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: BASE_TIME,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
  })

  it('rejects a fourth overlapping reservation when all units are booked', async () => {
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          resource: resourceId,
          service: serviceId,
          startTime: BASE_TIME,
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })

  it('does not conflict when the new reservation is completely after existing ones', async () => {
    // Existing reservations end at 10:00 (1h after 09:00). 10:05 is clear.
    const nonOverlappingTime = '2030-01-10T10:05:00.000Z'
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: nonOverlappingTime,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Capacity mode: capacityMode: 'per-guest'
// Reservations consume guestCount units of the resource's total quantity.
// ---------------------------------------------------------------------------
describe('Reservation plugin - capacity mode (per-guest)', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  const BASE_TIME = '2030-02-10T09:00:00.000Z'

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Per-Guest Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    // 20 total guest slots
    const resource = await payload.create({
      collection: col('resources'),
      data: {
        name: 'Per-Guest Resource (qty=20)',
        active: true,
        capacityMode: 'per-guest',
        quantity: 20,
        services: [service.id],
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'perguest@example.com',
        firstName: 'PerGuest',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('allows booking with guestCount: 15 (15 of 20 consumed)', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        guestCount: 15,
        resource: resourceId,
        service: serviceId,
        startTime: BASE_TIME,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    expect(res.guestCount).toBe(15)
  })

  it('rejects booking with guestCount: 6 because 15+6=21 exceeds capacity of 20', async () => {
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          guestCount: 6,
          resource: resourceId,
          service: serviceId,
          startTime: BASE_TIME,
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })

  it('allows booking with guestCount: 5 because 15+5=20 is exactly at capacity', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        guestCount: 5,
        resource: resourceId,
        service: serviceId,
        startTime: BASE_TIME,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    expect(res.guestCount).toBe(5)
  })

  it('rejects any additional booking once capacity is fully consumed (20/20)', async () => {
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          guestCount: 1,
          resource: resourceId,
          service: serviceId,
          startTime: BASE_TIME,
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------
describe('Reservation plugin - idempotency key', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Idempotency Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 30,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Idempotency Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'idempotency@example.com',
        firstName: 'Idempotency',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('creates a reservation when a new idempotency key is provided', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        idempotencyKey: 'idem-key-alpha',
        resource: resourceId,
        service: serviceId,
        startTime: '2030-03-10T09:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    expect(res.idempotencyKey).toBe('idem-key-alpha')
  })

  it('rejects a reservation with a duplicate idempotency key', async () => {
    // Use a different time to ensure the conflict is caused by idempotency,
    // not by a scheduling overlap.
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          idempotencyKey: 'idem-key-alpha',
          resource: resourceId,
          service: serviceId,
          startTime: '2030-03-10T11:00:00.000Z',
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })

  it('allows a reservation with a different idempotency key', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        idempotencyKey: 'idem-key-beta',
        resource: resourceId,
        service: serviceId,
        startTime: '2030-03-10T11:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    expect(res.idempotencyKey).toBe('idem-key-beta')
  })

  it('omitting an idempotency key does not cause any errors', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: '2030-03-10T13:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    // idempotencyKey should be absent or null/undefined when not provided
    expect(res.idempotencyKey == null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// guestCount field
// ---------------------------------------------------------------------------
describe('Reservation plugin - guestCount field', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'GuestCount Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'GuestCount Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'guestcount@example.com',
        firstName: 'GuestCount',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('defaults guestCount to 1 when not supplied', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: '2030-04-10T09:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res.guestCount).toBe(1)
  })

  it('persists an explicit guestCount value', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        guestCount: 4,
        resource: resourceId,
        service: serviceId,
        // Use different time to avoid self-conflict since this resource has
        // quantity 1 (default per-reservation mode).
        startTime: '2030-04-10T10:00:00.000Z',
        status: 'pending',
      },
    })
    expect(res.guestCount).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// durationType field on Services
// ---------------------------------------------------------------------------
describe('Reservation plugin - durationType on Services', () => {
  let customerId: string

  beforeAll(async () => {
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'duration@example.com',
        firstName: 'Duration',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    customerId = customer.id
  })

  it('fixed durationType: endTime equals startTime + duration minutes', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Fixed Duration Service',
        active: true,
        duration: 45,
        durationType: 'fixed',
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Fixed Duration Resource', active: true, services: [service.id] },
    })

    const start = '2030-05-10T10:00:00.000Z'
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resource.id,
        service: service.id,
        startTime: start,
        status: 'pending',
      },
    })
    const expectedEnd = new Date('2030-05-10T10:45:00.000Z')
    expect(new Date(res.endTime as string).getTime()).toBe(expectedEnd.getTime())
  })

  it('full-day durationType: endTime is set to UTC end-of-day (23:59:59.999Z)', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Full Day Service',
        active: true,
        duration: 1,
        durationType: 'full-day',
      },
    })
    const fullDayResource = await payload.create({
      collection: col('resources'),
      data: { name: 'Full Day Resource', active: true, services: [service.id] },
    })

    // Dev config has no `timezone` set → defaults to UTC.
    // startTime is May 15 2030 08:00 UTC; endTime must be UTC end-of-day.
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: fullDayResource.id,
        service: service.id,
        startTime: '2030-05-15T08:00:00.000Z',
        status: 'pending',
      },
    })

    const endTime = new Date(res.endTime as string)
    // computeEndTime for full-day uses endOfDayInTimezone with the plugin's
    // configured timezone (UTC by default) — so end must be 23:59:59.999Z on
    // the same UTC calendar day.
    expect(endTime.toISOString()).toBe('2030-05-15T23:59:59.999Z')
  })

  it('flexible durationType: endTime comes from the submitted endTime field', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Flexible Duration Service',
        active: true,
        duration: 30,
        durationType: 'flexible',
      },
    })
    const flexResource = await payload.create({
      collection: col('resources'),
      data: { name: 'Flex Resource', active: true, services: [service.id] },
    })

    const start = '2030-05-20T10:00:00.000Z'
    const explicitEnd = '2030-05-20T11:30:00.000Z'
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        endTime: explicitEnd,
        resource: flexResource.id,
        service: service.id,
        startTime: start,
        status: 'pending',
      },
    })
    expect(new Date(res.endTime as string).getTime()).toBe(new Date(explicitEnd).getTime())
  })

  it('flexible durationType: rejects create when endTime is not supplied', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Flexible No-EndTime Service',
        active: true,
        duration: 30,
        durationType: 'flexible',
      },
    })
    const flexResource = await payload.create({
      collection: col('resources'),
      data: { name: 'Flex No-EndTime Resource', active: true, services: [service.id] },
    })

    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          resource: flexResource.id,
          service: service.id,
          startTime: '2030-05-20T14:00:00.000Z',
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// getAvailableSlots via Payload Local API (unit-level integration)
// Tests that slots are returned and disappear after a booking.
// Schedule times use local-time setHours(), so we construct date with local
// constructors to avoid timezone mismatches in CI environments.
// ---------------------------------------------------------------------------
describe('Reservation plugin - available slots (getAvailableSlots service)', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  // April 8 2030 is a confirmed Monday. Pass a day-key string so resolution is
  // TZ-independent (avoids server-local new Date(y,m,d) midnight ambiguity).
  const MONDAY_LOCAL = '2030-04-08'

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Slots Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
        durationType: 'fixed',
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Slots Resource', active: true, services: [service.id] },
    })
    // Create a Monday recurring schedule: 09:00–12:00 local → 3 x 1h slots
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'Slots Monday Schedule',
        active: true,
        recurringSlots: [{ day: 'mon', endTime: '12:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'slots@example.com',
        firstName: 'Slots',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('returns available slots for a resource with a schedule', async () => {
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')

    const slots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId,
      serviceSlug: 'services',
    })

    // Schedule is 09:00–12:00 local, 1h duration, 15-min step → 9 slots
    // (09:00, 09:15, 09:30, 09:45, 10:00, 10:15, 10:30, 10:45, 11:00)
    expect(slots.length).toBe(9)
    expect(slots[0]).toHaveProperty('start')
    expect(slots[0]).toHaveProperty('end')
  })

  it('returns one fewer slot after booking the first available slot', async () => {
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')

    // First, get the current slots so we can book the first one using its
    // exact ISO startTime (avoids UTC/local timezone mismatch).
    const initialSlots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId,
      serviceSlug: 'services',
    })
    expect(initialSlots.length).toBeGreaterThan(0)

    const firstSlotStart = initialSlots[0].start.toISOString()

    // Book that slot via the Payload API
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceId,
        service: serviceId,
        startTime: firstSlotStart,
        status: 'pending',
      },
    })

    // Re-query: should be one fewer slot
    const remainingSlots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId,
      serviceSlug: 'services',
    })

    // With 15-min step, booking the first slot (09:00-10:00) blocks all
    // overlapping candidates (09:00, 09:15, 09:30, 09:45) → 4 fewer slots
    expect(remainingSlots.length).toBeLessThan(initialSlots.length)
    // The booked start time should no longer appear
    const remainingStarts = remainingSlots.map((s) => s.start.toISOString())
    expect(remainingStarts).not.toContain(firstSlotStart)
  })

  it('returns an empty array for a resource with no schedule', async () => {
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')

    const noScheduleResource = await payload.create({
      collection: col('resources'),
      data: { name: 'No-Schedule Resource', active: true, services: [serviceId] },
    })

    const slots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: noScheduleResource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId,
      serviceSlug: 'services',
    })

    expect(slots).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Multi-resource bookings (items array)
// ---------------------------------------------------------------------------
describe('Reservation plugin - multi-resource bookings (items array)', () => {
  let serviceId: string
  let resourceAId: string
  let resourceBId: string
  let customerId: string

  const MULTI_START_1 = '2030-06-10T09:00:00.000Z'
  const MULTI_START_2 = '2030-06-10T11:00:00.000Z'

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'Multi-Resource Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resourceA = await payload.create({
      collection: col('resources'),
      data: { name: 'Multi Resource A', active: true, services: [service.id] },
    })
    const resourceB = await payload.create({
      collection: col('resources'),
      data: { name: 'Multi Resource B', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'multi@example.com',
        firstName: 'Multi',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceAId = resourceA.id
    resourceBId = resourceB.id
    customerId = customer.id
  })

  it('creates a reservation with items covering two different resources', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        items: [
          {
            resource: resourceAId,
            service: serviceId,
            startTime: MULTI_START_1,
          },
          {
            resource: resourceBId,
            service: serviceId,
            startTime: MULTI_START_1,
          },
        ],
        resource: resourceAId,
        service: serviceId,
        startTime: MULTI_START_1,
        status: 'pending',
      },
    })
    expect(res.id).toBeDefined()
    expect(Array.isArray(res.items)).toBe(true)
    expect((res.items as unknown[]).length).toBe(2)
  })

  it('rejects a booking when one of the items conflicts with an existing reservation', async () => {
    // First, book resourceB standalone so it is fully occupied at MULTI_START_2
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: resourceBId,
        service: serviceId,
        startTime: MULTI_START_2,
        status: 'pending',
      },
    })

    // Now try a multi-resource booking that includes resourceB at the same time
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customerId,
          items: [
            {
              resource: resourceAId,
              service: serviceId,
              startTime: MULTI_START_2,
            },
            {
              resource: resourceBId,
              service: serviceId,
              startTime: MULTI_START_2,
            },
          ],
          resource: resourceAId,
          service: serviceId,
          startTime: MULTI_START_2,
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })
})

describe('Reservation plugin - occupancy counting for items-held resources', () => {
  let svcId: string
  let primaryId: string
  let poolId: string
  let custId: string
  const T = '2031-03-04T09:00:00.000Z'

  beforeAll(async () => {
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'Occupancy Svc', active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60 },
    })
    const primary = await payload.create({
      collection: col('resources'),
      data: { name: 'Occupancy Primary', active: true, services: [svc.id] },
    })
    const pool = await payload.create({
      collection: col('resources'),
      data: { name: 'Occupancy Pool', active: true, quantity: 1, services: [svc.id] },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'occ@example.com', firstName: 'Occ', lastName: 'Test', password: 'testpass123' },
    })
    svcId = svc.id
    primaryId = primary.id
    poolId = pool.id
    custId = cust.id
  })

  it('rejects a standalone booking on a resource already held only in another booking\'s items[]', async () => {
    // Booking 1 holds poolId ONLY inside items[]; top-level resource is primaryId.
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: custId,
        items: [
          { resource: primaryId, service: svcId, startTime: T },
          { resource: poolId, service: svcId, startTime: T },
        ],
        resource: primaryId,
        service: svcId,
        startTime: T,
        status: 'pending',
      },
    })

    // Booking 2 books poolId standalone at the same time. poolId quantity is 1,
    // so this MUST be rejected once items[] occupancy is counted.
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: custId, resource: poolId, service: svcId, startTime: T, status: 'pending' },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// skipReservationHooks escape hatch
// ---------------------------------------------------------------------------
describe('Reservation plugin - skipReservationHooks context flag', () => {
  let serviceId: string
  let resourceId: string
  let customerId: string

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Skip Hooks Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Skip Hooks Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'skiphooks@example.com',
        firstName: 'SkipHooks',
        lastName: 'Tester',
        password: 'testpass123',
      },
    })
    serviceId = service.id
    resourceId = resource.id
    customerId = customer.id
  })

  it('bypasses status validation when skipReservationHooks is true', async () => {
    // Normally, creating a reservation as 'completed' is forbidden.
    // With the escape hatch it should succeed.
    const res = await payload.create({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: customerId,
        endTime: '2025-01-05T10:30:00.000Z',
        resource: resourceId,
        service: serviceId,
        startTime: '2025-01-05T10:00:00.000Z',
        status: 'completed',
      },
    })
    expect(res.status).toBe('completed')
  })

  it('bypasses conflict detection when skipReservationHooks is true', async () => {
    // Create two reservations at the exact same time on the same resource
    // without the conflict hook firing.
    const time = '2025-01-06T10:00:00.000Z'
    const endTime = '2025-01-06T10:30:00.000Z'
    await payload.create({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: customerId,
        endTime,
        resource: resourceId,
        service: serviceId,
        startTime: time,
        status: 'pending',
      },
    })
    const res2 = await payload.create({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: customerId,
        endTime,
        resource: resourceId,
        service: serviceId,
        startTime: time,
        status: 'pending',
      },
    })
    expect(res2.id).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// validateStatusTransition admin check (C1+H5)
// ---------------------------------------------------------------------------
describe('Reservation plugin - validateStatusTransition admin check', () => {
  test('customer user cannot create reservation with confirmed status', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Admin Check Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Admin Check Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'admin-check-customer@example.com',
        firstName: 'Admin',
        lastName: 'Check',
        password: 'testpass123',
      },
    })

    // Customer trying to create as 'confirmed' should fail
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2025-09-01T10:00:00.000Z',
          status: 'confirmed',
        },
        overrideAccess: false,
        user: customer,
      }),
    ).rejects.toThrow()
  })

  test('context.allowConfirmedOnCreate bypasses admin check', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Context Bypass Service', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Context Bypass Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'context-bypass@example.com',
        firstName: 'Context',
        lastName: 'Bypass',
        password: 'testpass123',
      },
    })

    // With context flag, non-admin can create confirmed (payment hook flow)
    const reservation = await payload.create({
      collection: col('reservations'),
      context: { allowConfirmedOnCreate: true },
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-09-01T14:00:00.000Z',
        status: 'confirmed',
      },
    })
    expect(reservation.status).toBe('confirmed')
  })
})

// ---------------------------------------------------------------------------
// Cancel endpoint authorization (C2)
// Note: Full endpoint tests require a running server (E2E).
// Here we verify the ownership logic works via the Local API — the cancel
// endpoint calls payload.update which triggers hooks, so we verify that
// a non-owner customer cannot cancel another customer's reservation through
// overrideAccess: false.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Customer search authorization (L3)
// Note: Endpoint-level auth (403 for customer users) is verified in E2E.
// The implementation restricts customer collection users from searching.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-item buffer times (H1)
// ---------------------------------------------------------------------------
describe('Reservation plugin - per-item buffer times', () => {
  test('multi-resource booking uses per-item service buffers for conflict detection', async () => {
    // Service with no buffer
    const noBufferSvc = await payload.create({
      collection: col('services'),
      data: { name: 'No Buffer Svc', active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 30 },
    })
    // Service with 60min bufferBefore
    const bigBufferSvc = await payload.create({
      collection: col('services'),
      data: { name: 'Big Buffer Svc', active: true, bufferTimeAfter: 0, bufferTimeBefore: 60, duration: 30 },
    })
    const resourceX = await payload.create({
      collection: col('resources'),
      data: { name: 'Buffer Resource X', active: true, services: [noBufferSvc.id, bigBufferSvc.id] },
    })
    const resourceY = await payload.create({
      collection: col('resources'),
      data: { name: 'Buffer Resource Y', active: true, services: [noBufferSvc.id, bigBufferSvc.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'buffer-test@example.com', firstName: 'Buffer', lastName: 'Test', password: 'testpass123' },
    })

    // Existing booking on Resource X at 10:00-10:30
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resourceX.id,
        service: noBufferSvc.id,
        startTime: '2025-11-01T10:00:00.000Z',
        status: 'pending',
      },
    })

    // Multi-resource booking:
    //   item[0]: Resource Y + noBufferSvc at 11:00 — no conflict (different resource)
    //   item[1]: Resource X + bigBufferSvc at 10:30 — bufferBefore=60 makes effective start 09:30
    //     so effective window 09:30-11:00 overlaps existing 10:00-10:30 → conflict
    // BUG: if primary service (noBufferSvc, buffer=0) is used for all items,
    //       item[1]'s effective window would be 10:30-11:00, NO overlap with 10:00-10:30
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          items: [
            { resource: resourceY.id, service: noBufferSvc.id, startTime: '2025-11-01T11:00:00.000Z' },
            { resource: resourceX.id, service: bigBufferSvc.id, startTime: '2025-11-01T10:30:00.000Z' },
          ],
          resource: resourceY.id,
          service: noBufferSvc.id,
          startTime: '2025-11-01T11:00:00.000Z',
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Slot generation with buffers (H3)
// ---------------------------------------------------------------------------
describe('Reservation plugin - slot generation with buffers', () => {
  test('getAvailableSlots finds slots at non-duration-aligned positions', async () => {
    // 60-min service with 30-min bufferBefore
    // With step=60 (current): candidates are 09:00, 10:00, 11:00, 12:00
    //   10:00 fails because bufferBefore pushes effective start to 09:30 → overlaps existing 09:00-10:00
    //   10:30 would succeed but is never generated!
    // With step=15 (fix): candidates include 10:30 → found!
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Step Size Service', active: true, bufferTimeAfter: 0, bufferTimeBefore: 30, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Step Size Resource', active: true, services: [service.id] },
    })
    // Monday schedule 09:00-13:00 local
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'Step Size Schedule',
        active: true,
        recurringSlots: [{ day: 'mon', endTime: '13:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: 'step-size@example.com', firstName: 'Step', lastName: 'Size', password: 'testpass123' },
    })

    const MONDAY_LOCAL = '2030-06-17' // Mon Jun 17 2030 — day-key string, TZ-independent
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')

    // Get initial slots and book the first one (09:00-10:00)
    const initialSlots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
    })

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: initialSlots[0].start.toISOString(),
        status: 'pending',
      },
    })

    // Re-query
    const afterSlots = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: MONDAY_LOCAL,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
    })

    // With smaller step size, we should find 10:30 as the first available slot
    // (10:00 is blocked by bufferBefore=30 overlapping with existing 09:00-10:00)
    // Slots are UTC instants; use getUTCHours/getUTCMinutes to avoid server-TZ drift.
    const afterStartMinutes = afterSlots.map((s) => s.start.getUTCHours() * 60 + s.start.getUTCMinutes())
    const tenThirtyMinutes = 10 * 60 + 30
    expect(afterStartMinutes).toContain(tenThirtyMinutes)
  })
})

// ---------------------------------------------------------------------------
// Schedule time validation (H2+M3)
// ---------------------------------------------------------------------------
describe('Reservation plugin - schedule time validation', () => {
  let resourceId: string

  beforeAll(async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Time Validate Service', active: true, duration: 30 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Time Validate Resource', active: true, services: [service.id] },
    })
    resourceId = resource.id
  })

  test('rejects schedule with invalid time format', async () => {
    await expect(
      payload.create({
        collection: col('schedules'),
        data: {
          name: 'Bad Schedule',
          active: true,
          recurringSlots: [{ day: 'mon', endTime: '25:99', startTime: '09:00' }],
          resource: resourceId,
          scheduleType: 'recurring',
        },
      }),
    ).rejects.toThrow()
  })

  test('rejects schedule where endTime is before startTime', async () => {
    await expect(
      payload.create({
        collection: col('schedules'),
        data: {
          name: 'Backwards Schedule',
          active: true,
          recurringSlots: [{ day: 'mon', endTime: '08:00', startTime: '17:00' }],
          resource: resourceId,
          scheduleType: 'recurring',
        },
      }),
    ).rejects.toThrow()
  })

  test('accepts schedule with valid time format', async () => {
    const schedule = await payload.create({
      collection: col('schedules'),
      data: {
        name: 'Good Schedule',
        active: true,
        recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
        resource: resourceId,
        scheduleType: 'recurring',
      },
    })
    expect(schedule.name).toBe('Good Schedule')
  })
})

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------
describe('AvailabilityService - pure functions', () => {
  it('computeEndTime: fixed returns startTime + duration', async () => {
    const { computeEndTime } = await import('../src/services/AvailabilityService.js')
    const start = new Date('2030-01-01T08:00:00.000Z')
    const result = computeEndTime({ durationType: 'fixed', serviceDuration: 90, startTime: start })
    expect(result.endTime.getTime()).toBe(new Date('2030-01-01T09:30:00.000Z').getTime())
    expect(result.durationMinutes).toBe(90)
  })

  it('computeEndTime: full-day returns end of the same UTC day (23:59:59.999Z)', async () => {
    const { computeEndTime } = await import('../src/services/AvailabilityService.js')
    const start = new Date('2030-01-01T06:00:00.000Z')
    const result = computeEndTime({ durationType: 'full-day', serviceDuration: 0, startTime: start })
    // Default timeZone is UTC — end must be the UTC end of the same calendar day.
    expect(result.endTime.toISOString()).toBe('2030-01-01T23:59:59.999Z')
  })

  it('computeEndTime: flexible uses the provided endTime directly', async () => {
    const { computeEndTime } = await import('../src/services/AvailabilityService.js')
    const start = new Date('2030-01-01T09:00:00.000Z')
    const end = new Date('2030-01-01T11:45:00.000Z')
    const result = computeEndTime({
      durationType: 'flexible',
      endTime: end,
      serviceDuration: 30,
      startTime: start,
    })
    expect(result.endTime.getTime()).toBe(end.getTime())
    expect(result.durationMinutes).toBe(165)
  })

  it('validateTransition: allows valid pending -> confirmed', async () => {
    const { validateTransition } = await import('../src/services/AvailabilityService.js')
    const { DEFAULT_STATUS_MACHINE } = await import('../src/types.js')
    const result = validateTransition('pending', 'confirmed', DEFAULT_STATUS_MACHINE)
    expect(result.valid).toBe(true)
  })

  it('validateTransition: rejects invalid completed -> pending', async () => {
    const { validateTransition } = await import('../src/services/AvailabilityService.js')
    const { DEFAULT_STATUS_MACHINE } = await import('../src/types.js')
    const result = validateTransition('completed', 'pending', DEFAULT_STATUS_MACHINE)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('validateTransition: rejects transition from unknown status', async () => {
    const { validateTransition } = await import('../src/services/AvailabilityService.js')
    const { DEFAULT_STATUS_MACHINE } = await import('../src/types.js')
    const result = validateTransition('ghost', 'pending', DEFAULT_STATUS_MACHINE)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('ghost')
  })

  it('isBlockingStatus: pending and confirmed are blocking', async () => {
    const { isBlockingStatus } = await import('../src/services/AvailabilityService.js')
    const { DEFAULT_STATUS_MACHINE } = await import('../src/types.js')
    expect(isBlockingStatus('pending', DEFAULT_STATUS_MACHINE)).toBe(true)
    expect(isBlockingStatus('confirmed', DEFAULT_STATUS_MACHINE)).toBe(true)
  })

  it('isBlockingStatus: completed, cancelled, no-show are non-blocking', async () => {
    const { isBlockingStatus } = await import('../src/services/AvailabilityService.js')
    const { DEFAULT_STATUS_MACHINE } = await import('../src/types.js')
    expect(isBlockingStatus('completed', DEFAULT_STATUS_MACHINE)).toBe(false)
    expect(isBlockingStatus('cancelled', DEFAULT_STATUS_MACHINE)).toBe(false)
    expect(isBlockingStatus('no-show', DEFAULT_STATUS_MACHINE)).toBe(false)
  })

  it('buildOverlapQuery: returns a compound WHERE clause with all conditions', async () => {
    const { buildOverlapQuery } = await import('../src/services/AvailabilityService.js')
    const start = new Date('2030-01-01T09:00:00.000Z')
    const end = new Date('2030-01-01T10:00:00.000Z')
    const where = buildOverlapQuery({
      blockingStatuses: ['pending', 'confirmed'],
      effectiveEnd: end,
      effectiveStart: start,
      resourceId: 'res-123',
    })
    // Should be an AND compound query
    expect(where).toHaveProperty('and')
    const conditions = (where as { and: unknown[] }).and
    expect(conditions.length).toBeGreaterThanOrEqual(4)
  })

  it('buildOverlapQuery: matches a resource in either top-level or items', async () => {
    const { buildOverlapQuery } = await import('../src/services/AvailabilityService.js')
    const where = buildOverlapQuery({
      blockingStatuses: ['pending', 'confirmed'],
      effectiveEnd: new Date('2030-01-01T10:00:00.000Z'),
      effectiveStart: new Date('2030-01-01T09:00:00.000Z'),
      resourceId: 'res-123',
    })
    const conditions = (where as { and: Array<Record<string, unknown>> }).and
    const orClause = conditions.find((c) => 'or' in c) as { or: unknown[] } | undefined
    expect(orClause).toBeDefined()
    expect(orClause!.or).toEqual([
      { resource: { equals: 'res-123' } },
      { 'items.resource': { equals: 'res-123' } },
    ])
  })
})

// ---------------------------------------------------------------------------
// resourceOwnerMode - access function factories (unit tests)
// These tests call the access factory functions directly with mock req objects.
// ---------------------------------------------------------------------------
describe('resourceOwnerMode - ownerAccess utility', () => {
  // Helper to build a minimal mock req
  const makeReq = (user?: Record<string, unknown>) => ({ user }) as unknown as Parameters<Access>[0]['req']

  describe('makeResourceOwnerAccess', () => {
    it('read: no user returns false', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq(undefined) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })

    it('read: regular user returns owner Where clause', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-1', role: 'host' }) } as Parameters<Access>[0])
      expect(result).toEqual({ owner: { equals: 'user-1' } })
    })

    it('read: admin user returns true (bypass)', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'admin-1', role: 'admin' }) } as Parameters<Access>[0])
      expect(result).toBe(true)
    })

    it('create: authenticated user returns true', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.create({ req: makeReq({ id: 'user-1' }) } as Parameters<Access>[0])
      expect(result).toBe(true)
    })

    it('create: unauthenticated returns false', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.create({ req: makeReq(undefined) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })

    it('update: regular user returns owner Where clause', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.update({ req: makeReq({ id: 'user-2', role: 'host' }) } as Parameters<Access>[0])
      expect(result).toEqual({ owner: { equals: 'user-2' } })
    })

    it('uses custom ownerField name when configured', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: [], ownedServices: false, ownerField: 'managedBy' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-3' }) } as Parameters<Access>[0])
      expect(result).toEqual({ managedBy: { equals: 'user-3' } })
    })

    it('no adminRoles: no bypass even for users with a role field', async () => {
      const { makeResourceOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeResourceOwnerAccess({ adminRoles: [], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-4', role: 'admin' }) } as Parameters<Access>[0])
      // adminRoles is empty → isAdmin returns false → falls through to Where clause
      expect(result).toEqual({ owner: { equals: 'user-4' } })
    })
  })

  describe('makeScheduleOwnerAccess', () => {
    it('read: no user returns false', async () => {
      const { makeScheduleOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeScheduleOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq(undefined) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })

    it('read: regular user returns resource.owner Where clause', async () => {
      const { makeScheduleOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeScheduleOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-1', role: 'host' }) } as Parameters<Access>[0])
      expect(result).toEqual({ 'resource.owner': { equals: 'user-1' } })
    })

    it('read: admin bypasses filter', async () => {
      const { makeScheduleOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeScheduleOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'admin-1', role: 'admin' }) } as Parameters<Access>[0])
      expect(result).toBe(true)
    })

    it('uses custom ownerField in join path', async () => {
      const { makeScheduleOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeScheduleOwnerAccess({ adminRoles: [], ownedServices: false, ownerField: 'managedBy' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-5' }) } as Parameters<Access>[0])
      expect(result).toEqual({ 'resource.managedBy': { equals: 'user-5' } })
    })
  })

  describe('makeReservationOwnerAccess', () => {
    it('read: no user returns false', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq(undefined) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })

    it('read: owner user returns resource.owner Where clause', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'user-1', role: 'host' }) } as Parameters<Access>[0])
      expect(result).toEqual({ 'resource.owner': { equals: 'user-1' } })
    })

    it('read: admin bypasses filter', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.read({ req: makeReq({ id: 'admin-1', role: 'admin' }) } as Parameters<Access>[0])
      expect(result).toBe(true)
    })

    it('update: regular user returns false (mutations are admin-only)', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.update({ req: makeReq({ id: 'user-1', role: 'host' }) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })

    it('update: admin returns true', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.update({ req: makeReq({ id: 'admin-1', role: 'admin' }) } as Parameters<Access>[0])
      expect(result).toBe(true)
    })

    it('create: no user returns false (admin-only)', async () => {
      const { makeReservationOwnerAccess } = await import('../src/utilities/ownerAccess.js')
      const access = makeReservationOwnerAccess({ adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' }) as Record<string, Access>
      const result = access.create({ req: makeReq(undefined) } as Parameters<Access>[0])
      expect(result).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// resourceOwnerMode - collection factory integration
// Tests that the owner field is injected into collection configs.
// ---------------------------------------------------------------------------
describe('resourceOwnerMode - collection factory behaviour', () => {
  it('Resources collection: owner field is injected when resourceOwnerMode is set', async () => {
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'], ownerField: 'owner' },
      slugs: { customers: 'customers', resources: 'resources', services: 'services' },
    })
    const collection = createResourcesCollection(resolved)
    const fieldNames = collection.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(fieldNames).toContain('owner')
  })

  it('Resources collection: owner field is NOT added when resourceOwnerMode is absent', async () => {
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({})
    const collection = createResourcesCollection(resolved)
    const fieldNames = collection.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(fieldNames).not.toContain('owner')
  })

  it('Resources collection: custom ownerField name is used', async () => {
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({
      resourceOwnerMode: { ownerField: 'host' },
    })
    const collection = createResourcesCollection(resolved)
    const fieldNames = collection.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(fieldNames).toContain('host')
    expect(fieldNames).not.toContain('owner')
  })

  it('Services collection: owner field is injected when ownedServices: true', async () => {
    const { createServicesCollection } = await import('../src/collections/Services.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'], ownedServices: true },
    })
    const collection = createServicesCollection(resolved)
    const fieldNames = collection.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(fieldNames).toContain('owner')
  })

  it('Services collection: owner field is NOT added when ownedServices is false (default)', async () => {
    const { createServicesCollection } = await import('../src/collections/Services.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'] },
    })
    const collection = createServicesCollection(resolved)
    const fieldNames = collection.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(fieldNames).not.toContain('owner')
  })

  it('resolveConfig: resourceOwnerMode defaults are applied', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({ resourceOwnerMode: {} })
    expect(resolved.resourceOwnerMode).toEqual({
      adminRoles: [],
      ownedServices: false,
      ownerField: 'owner',
    })
  })

  it('resolveConfig: resourceOwnerMode is undefined when not set', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({})
    expect(resolved.resourceOwnerMode).toBeUndefined()
  })

  it("app's access override takes precedence over resourceOwnerMode auto-wiring", async () => {
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const customReadFn = () => true as const
    const resolved = resolveConfig({
      access: { resources: { read: customReadFn } },
      resourceOwnerMode: { adminRoles: ['admin'] },
    })
    const collection = createResourcesCollection(resolved)
    // The custom access function should be used, not the auto-wired one
    expect((collection.access as Record<string, unknown>).read).toBe(customReadFn)
  })
})

describe('Guest bookings - fields', () => {
  const findField = (slug: string, name: string) => {
    const collection = payload.config.collections.find((c) => c.slug === slug)
    return collection!.fields.find((f) => 'name' in f && f.name === name) as
      | ({ name: string } & Record<string, unknown>)
      | undefined
  }

  it('reservations customer field is optional', () => {
    const field = findField('reservations', 'customer')
    expect(field).toBeDefined()
    expect(field!.required).toBeFalsy()
  })

  it('reservations has a guest group field', () => {
    const field = findField('reservations', 'guest')
    expect(field).toBeDefined()
    expect(field!.type).toBe('group')
  })

  it('reservations has a cancellationToken field', () => {
    const field = findField('reservations', 'cancellationToken')
    expect(field).toBeDefined()
    expect(field!.type).toBe('text')
  })

  it('services has an allowGuestBooking select field', () => {
    const field = findField('services', 'allowGuestBooking')
    expect(field).toBeDefined()
    expect(field!.type).toBe('select')
  })
})

describe('Guest bookings - config', () => {
  it('allowGuestBooking resolves to false by default', () => {
    expect(resolveConfig({}).allowGuestBooking).toBe(false)
  })

  it('allowGuestBooking can be enabled at the plugin level', () => {
    expect(resolveConfig({ allowGuestBooking: true }).allowGuestBooking).toBe(true)
  })

  it('resolveGuestBookingAllowed honors service override, else plugin default', () => {
    expect(resolveGuestBookingAllowed({ allowGuestBooking: 'enabled' }, false)).toBe(true)
    expect(resolveGuestBookingAllowed({ allowGuestBooking: 'disabled' }, true)).toBe(false)
    expect(resolveGuestBookingAllowed({ allowGuestBooking: 'inherit' }, true)).toBe(true)
    expect(resolveGuestBookingAllowed({ allowGuestBooking: null }, true)).toBe(true)
    expect(resolveGuestBookingAllowed({}, true)).toBe(true)
    expect(resolveGuestBookingAllowed(undefined, false)).toBe(false)
  })
})

describe('Guest bookings - validation hook', () => {
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

  async function makeServiceAndResource(guestSetting: string) {
    const service = await payload.create({
      collection: col('services'),
      data: { name: `GB Service ${guestSetting}`, active: true, allowGuestBooking: guestSetting, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: `GB Resource ${guestSetting}`, active: true, services: [service.id] },
    })
    return { resource, service }
  }

  it('guest booking succeeds when the service enables it; token is generated', async () => {
    const { resource, service } = await makeServiceAndResource('enabled')
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        guest: { name: 'Jane Doe', email: 'jane@example.com' },
        resource: resource.id,
        service: service.id,
        startTime: future(72),
      },
    })
    expect(res.id).toBeDefined()
    expect(typeof (res as Record<string, unknown>).cancellationToken).toBe('string')
  })

  it('guest booking is rejected when the service disables it', async () => {
    const { resource, service } = await makeServiceAndResource('disabled')
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          guest: { name: 'Jane Doe', email: 'jane@example.com' },
          resource: resource.id,
          service: service.id,
          startTime: future(72),
        },
      }),
    ).rejects.toThrow()
  })

  it('booking with neither customer nor guest is rejected', async () => {
    const { resource, service } = await makeServiceAndResource('enabled')
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { resource: resource.id, service: service.id, startTime: future(72) },
      }),
    ).rejects.toThrow()
  })

  it('guest requires name and at least one contact method', async () => {
    const { resource, service } = await makeServiceAndResource('enabled')
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          guest: { name: 'No Contact' },
          resource: resource.id,
          service: service.id,
          startTime: future(72),
        },
      }),
    ).rejects.toThrow()
  })

  it('admin bypasses the per-service gate for guest bookings', async () => {
    const { resource, service } = await makeServiceAndResource('disabled')
    const hook = validateGuestBooking(resolveConfig({}))
    const data: Record<string, unknown> = {
      guest: { name: 'Walk In', email: 'admin-guest@example.com' },
      resource: resource.id,
      service: service.id,
      startTime: future(72),
    }
    const result = await hook({
      context: {},
      data,
      operation: 'create',
      req: { payload, t: (k: string) => k, user: { id: 1, collection: 'users' } },
    } as unknown as Parameters<ReturnType<typeof validateGuestBooking>>[0])
    expect(result).toBe(data)
    expect(typeof data.cancellationToken).toBe('string')
  })

  it('a customer booking does not receive a cancellation token', async () => {
    const { resource, service } = await makeServiceAndResource('enabled')
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: `cust-${Date.now()}@example.com`, firstName: 'Cust', lastName: 'Omer', password: 'password123' },
    })
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: future(72),
      },
    })
    expect(res.id).toBeDefined()
    expect((res as Record<string, unknown>).cancellationToken).toBeFalsy()
  })

  it('a booking with both a customer and a guest block is rejected', async () => {
    const { resource, service } = await makeServiceAndResource('enabled')
    const customer = await payload.create({
      collection: col('customers'),
      data: { email: `both-${Date.now()}@example.com`, firstName: 'Both', lastName: 'User', password: 'password123' },
    })
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          guest: { name: 'Ghost', email: 'ghost@example.com' },
          resource: resource.id,
          service: service.id,
          startTime: future(72),
        },
      }),
    ).rejects.toThrow()
  })
})

describe('Guest bookings - book endpoint', () => {
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

  it('book endpoint does not return the cancellationToken', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Endpoint GB Service', active: true, allowGuestBooking: 'enabled', duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Endpoint GB Resource', active: true, services: [service.id] },
    })

    const ep = createBookingEndpoint(resolveConfig({}))
    const req = {
      json: () =>
        Promise.resolve({
          guest: { name: 'Endpoint Guest', phone: '+15551230000' },
          resource: resource.id,
          service: service.id,
          startTime: future(96),
        }),
      payload,
      t: (k: string) => k,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    const json = (await resp.json()) as Record<string, unknown>

    expect(json.id).toBeDefined()
    expect(json.cancellationToken).toBeUndefined()
  })
})

describe('Guest bookings - cancel endpoint', () => {
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

  async function createGuestReservation() {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Cancel GB Service', active: true, allowGuestBooking: 'enabled', duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Cancel GB Resource', active: true, services: [service.id] },
    })
    // Far-future start so the cancellation notice period does not block it.
    return payload.create({
      collection: col('reservations'),
      data: {
        guest: { name: 'Cancel Guest', email: 'cancel@example.com' },
        resource: resource.id,
        service: service.id,
        startTime: future(24 * 30),
      },
    })
  }

  it('a valid token cancels a guest reservation', async () => {
    const reservation = await createGuestReservation()
    const token = (reservation as Record<string, unknown>).cancellationToken as string
    const ep = createCancelBookingEndpoint(resolveConfig({}))
    const req = {
      json: () => Promise.resolve({ reservationId: reservation.id, token }),
      payload,
      t: (k: string) => k,
      user: undefined,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    const json = (await resp.json()) as Record<string, unknown>
    expect(json.status).toBe('cancelled')
  })

  it('a wrong token is rejected with 403', async () => {
    const reservation = await createGuestReservation()
    const ep = createCancelBookingEndpoint(resolveConfig({}))
    const req = {
      json: () => Promise.resolve({ reservationId: reservation.id, token: 'wrong-token' }),
      payload,
      t: (k: string) => k,
      user: undefined,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(403)
  })

  it('a missing token (and no user) is rejected with 403', async () => {
    const reservation = await createGuestReservation()
    const ep = createCancelBookingEndpoint(resolveConfig({}))
    const req = {
      json: () => Promise.resolve({ reservationId: reservation.id }),
      payload,
      t: (k: string) => k,
      user: undefined,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(403)
  })

  it('does not return the cancellationToken in the cancel response', async () => {
    const reservation = await createGuestReservation()
    const token = (reservation as Record<string, unknown>).cancellationToken as string
    const ep = createCancelBookingEndpoint(resolveConfig({}))
    const req = {
      json: () => Promise.resolve({ reservationId: reservation.id, token }),
      payload,
      t: (k: string) => k,
      user: undefined,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    const json = (await resp.json()) as Record<string, unknown>
    expect(json.status).toBe('cancelled')
    expect(json.cancellationToken).toBeUndefined()
  })
})

describe('intersectIntervals', () => {
  const iv = (s: string, e: string) => ({ end: new Date(e), start: new Date(s) })

  it('returns overlap of two single intervals', async () => {
    const { intersectIntervals } = await import('../src/utilities/slotUtils.js')
    const out = intersectIntervals(
      [iv('2030-01-01T09:00:00Z', '2030-01-01T12:00:00Z')],
      [iv('2030-01-01T10:00:00Z', '2030-01-01T17:00:00Z')],
    )
    expect(out).toEqual([iv('2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z')])
  })

  it('handles split shifts (multiple intervals per side)', async () => {
    const { intersectIntervals } = await import('../src/utilities/slotUtils.js')
    const out = intersectIntervals(
      [iv('2030-01-01T09:00:00Z', '2030-01-01T12:00:00Z'), iv('2030-01-01T13:00:00Z', '2030-01-01T17:00:00Z')],
      [iv('2030-01-01T10:00:00Z', '2030-01-01T18:00:00Z')],
    )
    expect(out).toEqual([
      iv('2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z'),
      iv('2030-01-01T13:00:00Z', '2030-01-01T17:00:00Z'),
    ])
  })

  it('returns empty when there is no overlap', async () => {
    const { intersectIntervals } = await import('../src/utilities/slotUtils.js')
    const out = intersectIntervals(
      [iv('2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z')],
      [iv('2030-01-01T11:00:00Z', '2030-01-01T12:00:00Z')],
    )
    expect(out).toEqual([])
  })
})

describe('Reservation plugin - resourceType field', () => {
  it('resources collection has a resourceType field defaulting to the first resourceType (staff)', () => {
    const cfg = payload.config.collections.find((c) => c.slug === 'resources')
    const field = cfg!.fields.find((f) => 'name' in f && f.name === 'resourceType') as
      | { defaultValue?: string; options?: unknown[] }
      | undefined
    expect(field).toBeDefined()
    expect(field!.defaultValue).toBe('staff')
  })

  it('can create a resource with resourceType staff', async () => {
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'RT Svc', active: true, duration: 30 },
    })
    const r = await payload.create({
      collection: col('resources'),
      data: { name: 'Stylist RT', active: true, resourceType: 'staff', services: [svc.id] },
    })
    expect((r as { resourceType?: string }).resourceType).toBe('staff')
  })
})

describe('Reservation plugin - requiredResources field', () => {
  it('services collection has a hasMany requiredResources relationship', () => {
    const cfg = payload.config.collections.find((c) => c.slug === 'services')
    const field = cfg!.fields.find((f) => 'name' in f && f.name === 'requiredResources') as
      | { hasMany?: boolean; relationTo?: string; type?: string }
      | undefined
    expect(field).toBeDefined()
    expect(field!.type).toBe('relationship')
    expect(field!.hasMany).toBe(true)
    expect(field!.relationTo).toBe('resources')
  })

  it('can set requiredResources on a service', async () => {
    const pool = await payload.create({
      collection: col('services'),
      data: { name: 'RR pool svc', active: true, duration: 30 },
    })
    const chair = await payload.create({
      collection: col('resources'),
      data: { name: 'RR Chair', active: true, services: [pool.id] },
    })
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'RR Haircut', active: true, duration: 60, requiredResources: [chair.id] },
    })
    expect((svc as { requiredResources?: unknown[] }).requiredResources).toHaveLength(1)
  })
})

describe('mergeResourceIds', () => {
  it('dedupes primary and required ids preserving order', async () => {
    const { mergeResourceIds } = await import('../src/utilities/resolveRequiredResources.js')
    expect(mergeResourceIds(['a'], ['b', 'a'])).toEqual(['a', 'b'])
  })

  it('drops empty/undefined values', async () => {
    const { mergeResourceIds } = await import('../src/utilities/resolveRequiredResources.js')
    expect(mergeResourceIds(['a', ''], [undefined as unknown as string, 'c'])).toEqual(['a', 'c'])
  })

  it('treats numeric and string ids as distinct only by string value', async () => {
    const { mergeResourceIds } = await import('../src/utilities/resolveRequiredResources.js')
    expect(mergeResourceIds([1], [1, 2])).toEqual([1, 2])
  })
})

describe('Reservation plugin - requiredResources auto-expansion', () => {
  let svcId: string
  let stylistId: string
  let chairId: string
  let custId: string
  const T1 = '2032-05-04T09:00:00.000Z'
  const T2 = '2032-05-04T11:00:00.000Z'

  beforeAll(async () => {
    const chairSvc = await payload.create({
      collection: col('services'),
      data: { name: 'AX chair svc', active: true, duration: 60 },
    })
    const chair = await payload.create({
      collection: col('resources'),
      data: { name: 'AX Chair Pool', active: true, quantity: 1, services: [chairSvc.id] },
    })
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'AX Haircut', active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60, requiredResources: [chair.id] },
    })
    const stylist = await payload.create({
      collection: col('resources'),
      data: { name: 'AX Stylist', active: true, services: [svc.id] },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'ax@example.com', firstName: 'Ax', lastName: 'Test', password: 'testpass123' },
    })
    svcId = svc.id
    stylistId = stylist.id
    chairId = chair.id
    custId = cust.id
  })

  it('auto-creates an items[] entry for the required chair pool', async () => {
    const res = await payload.create({
      collection: col('reservations'),
      data: { customer: custId, resource: stylistId, service: svcId, startTime: T1, status: 'pending' },
    })
    const items = (res as { items?: Array<{ resource: unknown }> }).items ?? []
    const ids = items.map((i) => (typeof i.resource === 'object' ? (i.resource as { id: string }).id : i.resource))
    expect(ids).toContain(stylistId)
    expect(ids).toContain(chairId)
  })

  it('rejects a second booking when the required pool is full', async () => {
    await payload.create({
      collection: col('reservations'),
      data: { customer: custId, resource: stylistId, service: svcId, startTime: T2, status: 'pending' },
    })
    const stylist2 = await payload.create({
      collection: col('resources'),
      data: { name: 'AX Stylist 2', active: true, services: [svcId] },
    })
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: custId, resource: stylist2.id, service: svcId, startTime: T2, status: 'pending' },
      }),
    ).rejects.toThrow()
  })

  it('does not re-expand items on update (create-only)', async () => {
    const created = await payload.create({
      collection: col('reservations'),
      data: { customer: custId, resource: stylistId, service: svcId, startTime: '2032-05-04T13:00:00.000Z', status: 'pending' },
    })
    const createdItemCount = ((created as { items?: unknown[] }).items ?? []).length

    // Clear items and update; the hook must NOT re-add them on update.
    const updated = await payload.update({
      id: created.id,
      collection: col('reservations'),
      data: { items: [] },
    })
    expect(((updated as { items?: unknown[] }).items ?? []).length).toBe(0)
    // Sanity: create DID expand (so the test is meaningful)
    expect(createdItemCount).toBeGreaterThan(0)
  })
})

describe('Reservation plugin - multi-resource slot discovery', () => {
  let svcId: string
  let stylistId: string
  let chairId: string
  let custId: string
  const DAY = new Date(2033, 3, 4) // local midnight, arbitrary weekday

  // Seed all weekdays so the resolved window is the same regardless of which
  // weekday this date lands on in the host timezone.
  const allDaySlots = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({
    day,
    endTime: '12:00',
    startTime: '09:00',
  }))

  beforeAll(async () => {
    const chairSvc = await payload.create({
      collection: col('services'),
      data: { name: 'MS chair svc', active: true, duration: 60 },
    })
    const chair = await payload.create({
      collection: col('resources'),
      data: { name: 'MS Chair', active: true, quantity: 1, services: [chairSvc.id] },
    })
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'MS Haircut', active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60, durationType: 'fixed', requiredResources: [chair.id] },
    })
    const stylist = await payload.create({
      collection: col('resources'),
      data: { name: 'MS Stylist', active: true, services: [svc.id] },
    })
    // Stylist has a schedule (constrains time); chair has NO schedule (capacity-only).
    await payload.create({
      collection: col('schedules'),
      data: { name: 'MS Stylist Schedule', active: true, recurringSlots: allDaySlots, resource: stylist.id, scheduleType: 'recurring' },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'ms@example.com', firstName: 'Ms', lastName: 'Test', password: 'testpass123' },
    })
    svcId = svc.id
    stylistId = stylist.id
    chairId = chair.id
    custId = cust.id
  })

  const callSlots = async () => {
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')
    return getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: DAY,
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceIds: [stylistId, chairId],
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: svcId,
      serviceSlug: 'services',
    })
  }

  it('returns slots where both stylist and chair are free', async () => {
    const slots = await callSlots()
    // 09:00–12:00 window, 60-min fixed service, stepSize = min(60,15) = 15 min
    // → slots at 09:00, 09:15, 09:30, ..., 11:00 = 9 candidate slots, chair free.
    expect(slots.length).toBe(9)
  })

  it('drops a slot when the shared chair pool is fully booked at that time', async () => {
    const before = await callSlots()
    const target = before[0] // occupy the chair (quantity 1) at this slot's start
    await payload.create({
      collection: col('reservations'),
      data: { customer: custId, resource: chairId, service: svcId, startTime: target.start.toISOString(), status: 'pending' },
    })
    const after = await callSlots()
    // The booking at target.start blocks any candidate whose window overlaps the booked 09:00–10:00 range.
    // With stepSize=15 and 60-min slots: 09:00, 09:15, 09:30, 09:45 all overlap → 4 fewer slots.
    expect(after.some((s) => s.start.getTime() === target.start.getTime())).toBe(false)
    expect(after.length).toBeLessThan(before.length)
  })
})

describe('Reservation plugin - slots endpoint resource resolution', () => {
  it('unions service.requiredResources so a full pool removes a slot', async () => {
    const { createGetSlotsEndpoint } = await import('../src/endpoints/getSlots.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const resolved = resolveConfig({})

    const allDaySlots = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({
      day,
      endTime: '12:00',
      startTime: '09:00',
    }))

    const chairSvc = await payload.create({
      collection: col('services'),
      data: { name: 'EP chair svc', active: true, duration: 60 },
    })
    const chair = await payload.create({
      collection: col('resources'),
      data: { name: 'EP Chair', active: true, quantity: 1, services: [chairSvc.id] },
    })
    const svc = await payload.create({
      collection: col('services'),
      data: {
        name: 'EP Haircut',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
        durationType: 'fixed',
        requiredResources: [chair.id],
      },
    })
    const stylist = await payload.create({
      collection: col('resources'),
      data: { name: 'EP Stylist', active: true, services: [svc.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'EP Stylist Schedule',
        active: true,
        recurringSlots: allDaySlots,
        resource: stylist.id,
        scheduleType: 'recurring',
      },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'ep@example.com', firstName: 'Ep', lastName: 'Test', password: 'testpass123' },
    })

    const endpoint = createGetSlotsEndpoint(resolved)
    const makeReq = (qs: string) =>
      ({ payload, url: `http://localhost/api/reserve/slots?${qs}` }) as unknown as Parameters<
        typeof endpoint.handler
      >[0]
    const date = '2033-04-04'

    // Caller passes ONLY the stylist + service; endpoint must add the chair pool.
    const res1 = await endpoint.handler(makeReq(`date=${date}&service=${svc.id}&resource=${stylist.id}`))
    const body1 = await res1.json()
    expect(body1.slots.length).toBeGreaterThan(0)

    // Occupy the chair (quantity 1) at the first returned slot.
    // Must provide endTime explicitly because skipReservationHooks bypasses calculateEndTime.
    const occupyStart = new Date(body1.slots[0].start)
    const occupyEnd = new Date(occupyStart.getTime() + 60 * 60_000)
    await payload.create({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: cust.id,
        endTime: occupyEnd.toISOString(),
        resource: chair.id,
        service: svc.id,
        startTime: occupyStart.toISOString(),
        status: 'confirmed',
      },
    })

    const res2 = await endpoint.handler(makeReq(`date=${date}&service=${svc.id}&resource=${stylist.id}`))
    const body2 = await res2.json()
    // Fewer slots proves the endpoint resolved + capacity-checked the chair pool.
    // A 60-min booking at the first slot blocks all 15-min step slots that overlap it.
    expect(body2.slots.length).toBeLessThan(body1.slots.length)
    expect(body2.slots.some((s: { start: string }) => s.start === body1.slots[0].start)).toBe(false)
  })
})

describe('Reservation plugin - multi-resource startTime span', () => {
  let svcId: string
  let primaryId: string
  let earlyId: string
  let custId: string
  // Booking 1: top-level startTime 10:00, but an item holds `early` resource at 08:00-09:00.
  const PRIMARY_START = '2034-02-06T10:00:00.000Z'
  const EARLY_START = '2034-02-06T08:00:00.000Z'

  beforeAll(async () => {
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'Span Svc', active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60 },
    })
    const primary = await payload.create({
      collection: col('resources'),
      data: { name: 'Span Primary', active: true, services: [svc.id] },
    })
    const early = await payload.create({
      collection: col('resources'),
      data: { name: 'Span Early Pool', active: true, quantity: 1, services: [svc.id] },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'span@example.com', firstName: 'Span', lastName: 'Test', password: 'testpass123' },
    })
    svcId = svc.id
    primaryId = primary.id
    earlyId = early.id
    custId = cust.id
  })

  it('counts an items[] resource that starts before the top-level startTime', async () => {
    // Booking 1: top-level startTime 10:00; items hold `early` at 08:00-09:00 and primary at 10:00.
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: custId,
        items: [
          { resource: primaryId, service: svcId, startTime: PRIMARY_START },
          { resource: earlyId, service: svcId, startTime: EARLY_START },
        ],
        resource: primaryId,
        service: svcId,
        startTime: PRIMARY_START,
        status: 'pending',
      },
    })

    // Booking 2: standalone on `early` (quantity 1) at 08:00. The early pool is already
    // occupied 08:00-09:00 by Booking 1's item, so this MUST be rejected.
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: custId, resource: earlyId, service: svcId, startTime: EARLY_START, status: 'pending' },
      }),
    ).rejects.toThrow()
  })
})

describe('staffProvisioning + vocab config', () => {
  it('resolveConfig applies vocab defaults', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const r = resolveConfig({})
    expect(r.resourceTypes).toEqual(['staff', 'equipment', 'room'])
    expect(r.leaveTypes).toEqual(['vacation', 'sick', 'personal', 'closure', 'other'])
    expect(r.staffProvisioning).toBeUndefined()
  })

  it('resolveConfig resolves staffProvisioning defaults', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const r = resolveConfig({
      resourceOwnerMode: {},
      staffProvisioning: { staffRoles: ['staff'], userCollection: 'users' },
    })
    expect(r.staffProvisioning).toMatchObject({
      nameFrom: 'name',
      resourceType: 'staff',
      roleField: 'role',
      staffRoles: ['staff'],
      userCollection: 'users',
    })
  })

  it('throws when staffProvisioning set without resourceOwnerMode', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({ staffProvisioning: { staffRoles: ['staff'], userCollection: 'users' } }))
      .toThrow(/resourceOwnerMode/)
  })

  it('throws when staffRoles empty', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({ resourceOwnerMode: {}, staffProvisioning: { staffRoles: [], userCollection: 'users' } }))
      .toThrow(/staffRoles/)
  })

  it('throws when resourceType not in resourceTypes', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({
      resourceOwnerMode: {},
      staffProvisioning: { resourceType: 'wizard', staffRoles: ['staff'], userCollection: 'users' },
    })).toThrow(/resourceType/)
  })

  it('throws when no userCollection resolvable', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({ resourceOwnerMode: {}, staffProvisioning: { staffRoles: ['staff'] } }))
      .toThrow(/userCollection/)
  })

  it('throws when resourceTypes is empty', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({ resourceTypes: [] })).toThrow(/resourceTypes/)
  })

  it('throws when leaveTypes is empty', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    expect(() => resolveConfig({ leaveTypes: [] })).toThrow(/leaveTypes/)
  })
})

describe('buildSelectOptions', () => {
  it('capitalizes plain values', async () => {
    const { buildSelectOptions } = await import('../src/utilities/selectOptions.js')
    expect(buildSelectOptions(['staff', 'room'])).toEqual([
      { label: 'Staff', value: 'staff' },
      { label: 'Room', value: 'room' },
    ])
  })

  it('handles hyphenated values', async () => {
    const { buildSelectOptions } = await import('../src/utilities/selectOptions.js')
    expect(buildSelectOptions(['no-show'])).toEqual([{ label: 'No-show', value: 'no-show' }])
  })
})

describe('Resources field changes', () => {
  it('resourceType select has the three default options', () => {
    const resources = payload.config.collections.find((c) => c.slug === 'resources')!
    const field = resources.fields.find(
      (f): f is { name: string; options: Array<{ value: string }> } & Field =>
        'name' in f && f.name === 'resourceType',
    )!
    const values = field.options.map((o) => (typeof o === 'string' ? o : o.value))
    expect(values).toEqual(['staff', 'equipment', 'room'])
  })

  it('can create a resource without services', async () => {
    const r = await payload.create({
      collection: col('resources'),
      data: { name: 'Unassigned Staff', active: true },
    })
    expect(r.id).toBeDefined()
  })
})

describe('resolveOwnerValue', () => {
  it('forces req.user.id on create', async () => {
    const { resolveOwnerValue } = await import('../src/collections/Resources.js')
    const out = resolveOwnerValue({
      operation: 'create',
      req: { user: { id: 'admin1' } },
      value: 'someone-else',
    })
    expect(out).toBe('admin1')
  })

  it('returns value unchanged on update', async () => {
    const { resolveOwnerValue } = await import('../src/collections/Resources.js')
    const out = resolveOwnerValue({
      operation: 'update',
      req: { user: { id: 'admin1' } },
      value: 'staff-7',
    })
    expect(out).toBe('staff-7')
  })

  it('returns value unchanged when there is no req.user on create', async () => {
    const { resolveOwnerValue } = await import('../src/collections/Resources.js')
    const out = resolveOwnerValue({
      operation: 'create',
      req: { user: null },
      value: 'staff-7',
    })
    expect(out).toBe('staff-7')
  })
})

describe('Schedule exceptions range fields', () => {
  it('exceptions array has endDate and type subfields', () => {
    const schedules = payload.config.collections.find((c) => c.slug === 'schedules')!
    const exceptions = schedules.fields.find(
      (f): f is { fields: Field[]; name: string } & Field => 'name' in f && f.name === 'exceptions',
    )!
    const sub = exceptions.fields
      .filter((f): f is { name: string } & Field => 'name' in f)
      .map((f) => f.name)
    expect(sub).toContain('endDate')
    expect(sub).toContain('type')
  })

  it('rejects an exception whose endDate precedes date', async () => {
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Sched Range Res', active: true },
    })
    await expect(
      payload.create({
        collection: col('schedules'),
        data: {
          name: 'Bad Range',
          exceptions: [{ date: '2026-06-10T00:00:00.000Z', endDate: '2026-06-08T00:00:00.000Z' }],
          resource: resource.id,
          scheduleType: 'recurring',
        },
      }),
    ).rejects.toThrow()
  })
})

describe('isExceptionDate range-aware', () => {
  it('matches a single-day exception (back-compat)', async () => {
    const { isExceptionDate } = await import('../src/utilities/scheduleUtils.js')
    expect(isExceptionDate(new Date('2026-06-10T09:00:00Z'), [{ date: '2026-06-10T00:00:00Z' }])).toBe(true)
    expect(isExceptionDate(new Date('2026-06-11T09:00:00Z'), [{ date: '2026-06-10T00:00:00Z' }])).toBe(false)
  })

  it('matches inside a range and both boundaries inclusively', async () => {
    const { isExceptionDate } = await import('../src/utilities/scheduleUtils.js')
    const exc = [{ date: '2026-06-08T00:00:00Z', endDate: '2026-06-12T00:00:00Z' }]
    expect(isExceptionDate(new Date('2026-06-08T09:00:00Z'), exc)).toBe(true) // start boundary
    expect(isExceptionDate(new Date('2026-06-10T09:00:00Z'), exc)).toBe(true) // inside
    expect(isExceptionDate(new Date('2026-06-12T09:00:00Z'), exc)).toBe(true) // end boundary
    expect(isExceptionDate(new Date('2026-06-13T09:00:00Z'), exc)).toBe(false) // outside
    expect(isExceptionDate(new Date('2026-06-07T09:00:00Z'), exc)).toBe(false) // before
  })

  it('resolveScheduleForDate returns [] inside a vacation range', async () => {
    const { resolveScheduleForDate } = await import('../src/utilities/scheduleUtils.js')
    const schedule = {
      exceptions: [{ date: '2026-06-08T00:00:00Z', endDate: '2026-06-12T00:00:00Z' }],
      recurringSlots: [{ day: 'wed' as const, endTime: '17:00', startTime: '09:00' }],
      scheduleType: 'recurring' as const,
    }
    // 2026-06-10 is a Wednesday inside the range
    expect(resolveScheduleForDate(schedule, new Date('2026-06-10T00:00:00Z'))).toEqual([])
    // 2026-06-17 is a Wednesday outside the range
    expect(resolveScheduleForDate(schedule, new Date('2026-06-17T00:00:00Z')).length).toBe(1)
  })
})

describe('provisionStaffResource hook', () => {
  const baseConfig = {
    resourceOwnerMode: { adminRoles: ['admin'], ownedServices: false, ownerField: 'owner' },
    slugs: { resources: 'resources' },
    staffProvisioning: {
      nameFrom: 'name',
      resourceType: 'staff',
      roleField: 'role',
      staffRoles: ['staff'],
      userCollection: 'users',
    },
  }

  const makeReq = (created: unknown[], existing: unknown[] = []) => ({
    payload: {
      create: (args: { data: unknown }) => {
        created.push(args)
        return Promise.resolve({ id: 'res1', ...(args.data as object) })
      },
      find: () => Promise.resolve({ docs: existing }),
    },
    transactionID: 'txn-1',
    user: { id: 'admin1' },
  })

  it('provisions a resource owned by the new staff user on create (via impersonation)', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: Array<{
      collection: string
      data: Record<string, unknown>
      req: { transactionID?: unknown; user?: { id?: unknown } }
    }> = []
    await hook({
      context: {},
      doc: { id: 'staff1', name: 'Alice', email: 'a@x.com', role: 'staff' },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(1)
    expect(created[0].collection).toBe('resources')
    expect(created[0].data.owner).toBe('staff1')
    expect(created[0].data.resourceType).toBe('staff')
    expect(created[0].data.name).toBe('Alice')
    expect(created[0].req.user?.id).toBe('staff1')
    expect(created[0].req.transactionID).toBe('txn-1')
  })

  it('falls back to email when nameFrom field is absent', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: Array<{ data: Record<string, unknown> }> = []
    await hook({
      context: {},
      doc: { id: 'staff2', email: 'b@x.com', role: 'staff' },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created[0].data.name).toBe('b@x.com')
  })

  it('does nothing for a non-staff user', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: {},
      doc: { id: 'cust1', email: 'c@x.com', role: 'customer' },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(0)
  })

  it('is idempotent — skips when a resource already owns the user', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: {},
      doc: { id: 'staff1', email: 'a@x.com', role: 'staff' },
      operation: 'create',
      req: makeReq(created, [{ id: 'res-existing' }]) as never,
    } as never)
    expect(created).toHaveLength(0)
  })

  it('provisions on promotion (update into a staff role)', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: {},
      doc: { id: 'staff3', email: 'd@x.com', role: 'staff' },
      operation: 'update',
      previousDoc: { id: 'staff3', email: 'd@x.com', role: 'customer' },
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(1)
  })

  it('does NOT re-provision on an update that was already staff', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: {},
      doc: { id: 'staff3', email: 'd@x.com', role: 'staff' },
      operation: 'update',
      previousDoc: { id: 'staff3', email: 'd@x.com', role: 'staff' },
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(0)
  })

  it('runs beforeCreate to stamp custom fields', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const cfg = {
      ...baseConfig,
      staffProvisioning: {
        ...baseConfig.staffProvisioning,
        beforeCreate: ({ data }: { data: Record<string, unknown> }) => ({ ...data, tenant: 't-1' }),
      },
    }
    const hook = provisionStaffResource(cfg as never)
    const created: Array<{ data: Record<string, unknown> }> = []
    await hook({
      context: {},
      doc: { id: 'staff4', name: 'Eve', email: 'e@x.com', role: 'staff' },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created[0].data.tenant).toBe('t-1')
  })

  it('respects context.skipReservationHooks', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: { skipReservationHooks: true },
      doc: { id: 'staff1', email: 'a@x.com', role: 'staff' },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(0)
  })

  it('matches array-valued roles', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const created: unknown[] = []
    await hook({
      context: {},
      doc: { id: 'staff5', email: 'f@x.com', role: ['customer', 'staff'] },
      operation: 'create',
      req: makeReq(created) as never,
    } as never)
    expect(created).toHaveLength(1)
  })

  it('swallows and logs a provisioning failure instead of throwing', async () => {
    const { provisionStaffResource } = await import('../src/hooks/users/provisionStaffResource.js')
    const hook = provisionStaffResource(baseConfig as never)
    const errors: unknown[] = []
    const req = {
      payload: {
        create: () => Promise.reject(new Error('boom')),
        find: () => Promise.resolve({ docs: [] }),
        logger: { error: (e: unknown) => errors.push(e) },
      },
      transactionID: 'txn-1',
      user: { id: 'admin1' },
    }
    await expect(
      hook({
        context: {},
        doc: { id: 'staff9', name: 'Gus', email: 'g@x.com', role: 'staff' },
        operation: 'create',
        req: req as never,
      } as never),
    ).resolves.toBeDefined()
    expect(errors).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Leave range removes availability end-to-end (Task 9)
// ---------------------------------------------------------------------------
describe('leave range removes availability end-to-end', () => {
  it('returns no slots inside a vacation range and slots outside it', async () => {
    const { getAvailableSlots } = await import('../src/services/index.js')

    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Haircut LR', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Stylist LR', active: true, services: [service.id] },
    })
    // Vacation range 2026-06-08 (Mon) to 2026-06-12 (Fri)
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'Stylist LR shifts',
        active: true,
        exceptions: [{ date: '2026-06-08T00:00:00.000Z', endDate: '2026-06-12T00:00:00.000Z' }],
        recurringSlots: [
          { day: 'mon', endTime: '17:00', startTime: '09:00' },
          { day: 'tue', endTime: '17:00', startTime: '09:00' },
          { day: 'wed', endTime: '17:00', startTime: '09:00' },
          { day: 'thu', endTime: '17:00', startTime: '09:00' },
          { day: 'fri', endTime: '17:00', startTime: '09:00' },
        ],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })

    // 2026-06-10 (Wed) is inside the vacation range → no slots
    // Use UTC midnight so toISOString().split('T')[0] === '2026-06-10'
    const inRange = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: new Date('2026-06-10T00:00:00.000Z'),
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
    })
    expect(inRange.length).toBe(0)

    // 2026-06-17 (Wed) is outside the range → slots available
    const outRange = await getAvailableSlots({
      blockingStatuses: ['pending', 'confirmed'],
      date: new Date('2026-06-17T00:00:00.000Z'),
      payload,
      req: {} as Parameters<typeof getAvailableSlots>[0]['req'],
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
    })
    expect(outRange.length).toBeGreaterThan(0)
  })
})

describe('plugin wires staff provisioning', () => {
  const makeConfig = () => ({
    collections: [{ slug: 'users', auth: true, fields: [] as Field[], hooks: {} as Record<string, unknown> }],
  })

  it('injects an afterChange hook onto the staff user collection', async () => {
    const { payloadReserve } = await import('../src/index.js')
    const cfg = makeConfig()
    const out = payloadReserve({
      resourceOwnerMode: {},
      staffProvisioning: { staffRoles: ['staff'], userCollection: 'users' },
    })(cfg as never)
    const users = (out.collections as Array<{ hooks?: { afterChange?: unknown[] }; slug: string }>).find(
      (c) => c.slug === 'users',
    )!
    expect(users.hooks?.afterChange?.length).toBe(1)
  })

  it('preserves existing afterChange hooks on the user collection', async () => {
    const { payloadReserve } = await import('../src/index.js')
    const cfg = makeConfig()
    const existing = () => undefined
    cfg.collections[0].hooks = { afterChange: [existing] }
    const out = payloadReserve({
      resourceOwnerMode: {},
      staffProvisioning: { staffRoles: ['staff'], userCollection: 'users' },
    })(cfg as never)
    const users = (out.collections as Array<{ hooks?: { afterChange?: unknown[] }; slug: string }>).find(
      (c) => c.slug === 'users',
    )!
    expect(users.hooks?.afterChange?.length).toBe(2)
    expect(users.hooks?.afterChange?.[0]).toBe(existing)
  })

  it('throws when the staff user collection is not registered', async () => {
    const { payloadReserve } = await import('../src/index.js')
    expect(() =>
      payloadReserve({
        resourceOwnerMode: {},
        staffProvisioning: { staffRoles: ['staff'], userCollection: 'nonexistent' },
      })({ collections: [] } as never),
    ).toThrow(/nonexistent/)
  })
})

describe('isPrivilegedUser (role-aware staff detection)', () => {
  const twoCollection = { slugs: { customers: 'customers' } }
  const singleCollection = {
    resourceOwnerMode: { adminRoles: ['admin'] },
    slugs: { customers: 'users' },
    staffProvisioning: { roleField: 'role', staffRoles: ['staff'] },
    userCollection: 'users',
  }

  it('two-collection: a user outside the customers collection is privileged', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'users' } as never, twoCollection as never)).toBe(true)
  })

  it('two-collection: a user in the customers collection is not privileged', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'customers' } as never, twoCollection as never)).toBe(false)
  })

  it('single-collection: staff role is privileged', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'users', role: 'staff' } as never, singleCollection as never)).toBe(true)
  })

  it('single-collection: admin role is privileged', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'users', role: 'admin' } as never, singleCollection as never)).toBe(true)
  })

  it('single-collection: customer role is not privileged', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'users', role: 'customer' } as never, singleCollection as never)).toBe(false)
  })

  it('single-collection: array-valued role matches', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser({ id: '1', collection: 'users', role: ['customer', 'staff'] } as never, singleCollection as never)).toBe(true)
  })

  it('single-collection with no privileged roles configured: treats everyone as customer', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    const cfg = { slugs: { customers: 'users' }, userCollection: 'users' }
    expect(isPrivilegedUser({ id: '1', collection: 'users', role: 'admin' } as never, cfg as never)).toBe(false)
  })

  it('returns false for no user', async () => {
    const { isPrivilegedUser } = await import('../src/utilities/userRoles.js')
    expect(isPrivilegedUser(null, twoCollection as never)).toBe(false)
  })
})

describe('computeSlotStates', () => {
  const base = {
    capacityMode: 'per-reservation' as const,
    dayEnd: new Date('2026-06-08T17:00:00.000Z'),
    dayStart: new Date('2026-06-08T09:00:00.000Z'),
    quantity: 1,
    shiftWindows: [{ end: '2026-06-08T12:00:00.000Z', start: '2026-06-08T09:00:00.000Z' }],
    step: 60,
    timeOff: [],
  }

  it('marks slots outside shift windows as off-shift', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({ ...base, busy: [] })
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T09:00:00.000Z')!.state).toBe('free')
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T13:00:00.000Z')!.state).toBe('off-shift')
  })

  it('marks a slot full when occupancy reaches quantity', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({
      ...base,
      busy: [{ end: '2026-06-08T11:00:00.000Z', start: '2026-06-08T10:00:00.000Z', units: 1 }],
    })
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T10:00:00.000Z')!.state).toBe('full')
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T09:00:00.000Z')!.state).toBe('free')
  })

  it('stays free when occupancy is below quantity (capacity 2)', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({
      ...base,
      busy: [{ end: '2026-06-08T11:00:00.000Z', start: '2026-06-08T10:00:00.000Z', units: 1 }],
      quantity: 2,
    })
    const ten = slots.find((s) => s.start.toISOString() === '2026-06-08T10:00:00.000Z')!
    expect(ten.state).toBe('free')
    expect(ten.occupancy).toBe(1)
  })

  it('marks time-off slots', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({
      ...base,
      busy: [],
      timeOff: [{ end: '2026-06-08T12:00:00.000Z', start: '2026-06-08T09:00:00.000Z' }],
    })
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T10:00:00.000Z')!.state).toBe('time-off')
  })

  it('sums guestCount units in per-guest mode', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({
      ...base,
      busy: [{ end: '2026-06-08T11:00:00.000Z', start: '2026-06-08T10:00:00.000Z', units: 3 }],
      capacityMode: 'per-guest',
      quantity: 3,
    })
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T10:00:00.000Z')!.state).toBe('full')
  })
})

describe('resource-availability endpoint logic', () => {
  it('returns shift windows, time-off, and busy for a resource', async () => {
    const { buildResourceAvailability } = await import('../src/endpoints/resourceAvailability.js')

    const service = await payload.create({
      collection: col('services'),
      data: { name: 'RA Haircut', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'RA Stylist', active: true, quantity: 1, services: [service.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'RA shifts',
        active: true,
        exceptions: [{ type: 'vacation', date: '2026-06-15T00:00:00.000Z', reason: 'Off' }],
        recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'ra-stylist@example.com',
        firstName: 'RA',
        lastName: 'Customer',
        password: 'testpass123',
      },
    })
    await (payload.create as never as (a: unknown) => Promise<unknown>)({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: customer.id,
        endTime: '2026-06-08T11:00:00.000Z',
        resource: resource.id,
        service: service.id,
        startTime: '2026-06-08T10:00:00.000Z',
        status: 'pending',
      },
    })

    const result = await buildResourceAvailability({
      blockingStatuses: ['pending', 'confirmed'],
      end: new Date('2026-06-16T00:00:00.000Z'),
      payload,
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      start: new Date('2026-06-08T00:00:00.000Z'),
      timeZone: 'UTC',
    })

    expect(result.quantity).toBe(1)
    const monday = result.days.find((d) => d.date === '2026-06-08') // Monday → has a shift
    expect(monday?.shiftWindows.length).toBeGreaterThan(0)
    expect(result.busy.some((b) => new Date(b.start).toISOString() === '2026-06-08T10:00:00.000Z')).toBe(true)
    const vacationDay = result.days.find((d) => d.date === '2026-06-15')
    expect(vacationDay?.timeOff.length).toBeGreaterThan(0)
    expect(vacationDay?.timeOff[0]?.type).toBe('vacation')
  })

  it('ignores inactive schedules (no time-off leak)', async () => {
    const { buildResourceAvailability } = await import('../src/endpoints/resourceAvailability.js')
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'RA2 Svc', active: true, duration: 60 },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'RA2 Stylist', active: true, quantity: 1, services: [service.id] },
    })
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'RA2 inactive',
        active: false,
        exceptions: [{ type: 'vacation', date: '2026-07-06T00:00:00.000Z', reason: 'Off' }],
        recurringSlots: [{ day: 'mon', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    const result = await buildResourceAvailability({
      blockingStatuses: ['pending', 'confirmed'],
      end: new Date('2026-07-08T00:00:00.000Z'),
      payload,
      reservationSlug: 'reservations',
      resourceId: resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      start: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
    })
    const day = result.days.find((d) => d.date === '2026-07-06')
    expect(day?.shiftWindows.length ?? 0).toBe(0)
    expect(day?.timeOff.length ?? 0).toBe(0)
  })
})

describe('AvailabilityTimeField wiring', () => {
  it('startTime field has a custom Field component configured', () => {
    const reservations = payload.config.collections.find((c) => c.slug === 'reservations')!
    const startTime = reservations.fields.find(
      (f): f is { admin?: { components?: { Field?: unknown } }; name: string } & Field =>
        'name' in f && f.name === 'startTime',
    )!
    expect(startTime.admin?.components?.Field).toBeTruthy()
  })
})

describe('localDayKey', () => {
  it('uses local calendar components (not UTC)', async () => {
    const { localDayKey } = await import('../src/utilities/slotUtils.js')
    // Construct a local-midnight date; key must equal that local calendar day
    const d = new Date(2026, 5, 9, 0, 0, 0, 0) // local 2026-06-09 00:00
    expect(localDayKey(d)).toBe('2026-06-09')
    const evening = new Date(2026, 5, 9, 23, 30, 0, 0)
    expect(localDayKey(evening)).toBe('2026-06-09')
  })
})

describe('computeSlotStates required pools (chair-aware)', () => {
  it('marks a slot full when a required pool is at capacity even if the resource itself is free', async () => {
    const { computeSlotStates } = await import('../src/utilities/computeSlotStates.js')
    const slots = computeSlotStates({
      busy: [], // the stylist is free
      capacityMode: 'per-reservation',
      dayEnd: new Date('2026-06-08T12:00:00.000Z'),
      dayStart: new Date('2026-06-08T09:00:00.000Z'),
      quantity: 1,
      requiredPools: [
        {
          busy: [
            { end: '2026-06-08T11:00:00.000Z', start: '2026-06-08T10:00:00.000Z', units: 1 },
            { end: '2026-06-08T11:00:00.000Z', start: '2026-06-08T10:00:00.000Z', units: 1 },
          ],
          quantity: 2,
        },
      ],
      shiftWindows: [{ end: '2026-06-08T12:00:00.000Z', start: '2026-06-08T09:00:00.000Z' }],
      step: 60,
      timeOff: [],
    })
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T10:00:00.000Z')!.state).toBe('full')
    expect(slots.find((s) => s.start.toISOString() === '2026-06-08T09:00:00.000Z')!.state).toBe('free')
  })
})

describe('resource-availability requiredPools', () => {
  it('reports a required chair pool and its busy for a stylist whose service needs it', async () => {
    const { buildResourceAvailability } = await import('../src/endpoints/resourceAvailability.js')
    const chair = await payload.create({
      collection: col('resources'),
      data: { name: 'RP Chair', active: true, quantity: 2 },
    })
    const svc = await payload.create({
      collection: col('services'),
      data: { name: 'RP Svc', active: true, duration: 60, requiredResources: [chair.id] },
    })
    const stylist1 = await payload.create({
      collection: col('resources'),
      data: { name: 'RP Stylist 1', active: true, quantity: 1, services: [svc.id] },
    })
    const stylist2 = await payload.create({
      collection: col('resources'),
      data: { name: 'RP Stylist 2', active: true, quantity: 1, services: [svc.id] },
    })
    const cust = await payload.create({
      collection: col('customers'),
      data: { email: 'rp@example.com', firstName: 'Rp', lastName: 'Test', password: 'testpass123' },
    })
    // stylist2 takes the chair at 10:00 — stylist1 stays free, but the shared chair is busy.
    await (payload.create as never as (a: unknown) => Promise<unknown>)({
      collection: col('reservations'),
      context: { skipReservationHooks: true },
      data: {
        customer: cust.id,
        endTime: '2026-06-08T11:00:00.000Z',
        items: [
          { endTime: '2026-06-08T11:00:00.000Z', resource: chair.id, startTime: '2026-06-08T10:00:00.000Z' },
        ],
        resource: stylist2.id,
        service: svc.id,
        startTime: '2026-06-08T10:00:00.000Z',
        status: 'pending',
      },
    })

    const result = await buildResourceAvailability({
      blockingStatuses: ['pending', 'confirmed'],
      end: new Date('2026-06-09T00:00:00.000Z'),
      payload,
      reservationSlug: 'reservations',
      resourceId: stylist1.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      start: new Date('2026-06-08T00:00:00.000Z'),
      timeZone: 'UTC',
    })

    expect(result.requiredPools.length).toBe(1)
    expect(result.requiredPools[0].quantity).toBe(2)
    expect(result.requiredPools[0].busy.some((b) => new Date(b.start).toISOString() === '2026-06-08T10:00:00.000Z')).toBe(true)
    // stylist1 itself has no own booking — proving the pool busy is independent of the stylist
    expect(result.busy.length).toBe(0)
  })
})

describe('resourceOwnerMode owner field relationTo', () => {
  it('owner relates to the staffProvisioning user collection, not customers (separate users/customers)', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    // Mirrors the issue author: separate users + customers, staff provisioned from users
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'] },
      slugs: { customers: 'customers' },
      staffProvisioning: { roleField: 'roles', staffRoles: ['employee'], userCollection: 'users' },
    })
    const col = createResourcesCollection(resolved)
    const owner = col.fields.find(
      (f): f is { name: string; relationTo: string } & Field => 'name' in f && f.name === 'owner',
    )!
    expect(owner.relationTo).toBe('users')
  })

  it('honours an explicit ownerCollection override', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'], ownerCollection: 'staff' },
      staffProvisioning: { staffRoles: ['employee'], userCollection: 'users' },
    })
    const col = createResourcesCollection(resolved)
    const owner = col.fields.find(
      (f): f is { name: string; relationTo: string } & Field => 'name' in f && f.name === 'owner',
    )!
    expect(owner.relationTo).toBe('staff')
  })

  it('falls back to customers when no staffProvisioning/ownerCollection (back-compat)', async () => {
    const { resolveConfig } = await import('../src/defaults.js')
    const { createResourcesCollection } = await import('../src/collections/Resources.js')
    const resolved = resolveConfig({ resourceOwnerMode: { adminRoles: ['admin'] } })
    const col = createResourcesCollection(resolved)
    const owner = col.fields.find(
      (f): f is { name: string; relationTo: string } & Field => 'name' in f && f.name === 'owner',
    )!
    expect(owner.relationTo).toBe('customers')
  })
})

describe('Reservation plugin - multi-tenant config', () => {
  test('resolveConfig defaults the multiTenant option', () => {
    const resolved = resolveConfig({})
    expect(resolved.multiTenant).toEqual({ cookieName: 'payload-tenant', tenantField: 'tenant' })
  })

  test('resolveConfig honors overrides', () => {
    const resolved = resolveConfig({ multiTenant: { cookieName: 'x-tenant', tenantField: 'org' } })
    expect(resolved.multiTenant).toEqual({ cookieName: 'x-tenant', tenantField: 'org' })
  })

  test('resolveConfig falls back per-key on partial override', () => {
    const resolved = resolveConfig({ multiTenant: { tenantField: 'org' } })
    expect(resolved.multiTenant).toEqual({ cookieName: 'payload-tenant', tenantField: 'org' })
  })

  test('plugin publishes reservationTenant to admin.custom', () => {
    expect(payload.config.admin.custom?.reservationTenant).toEqual({
      cookieName: 'payload-tenant',
      tenantField: 'tenant',
    })
  })
})

describe('Reservation plugin - partial updates (review A1)', () => {
  test('PATCH startTime recomputes endTime from the service duration', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Recompute Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'A1 Recompute Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-recompute@example.com',
        firstName: 'A1',
        lastName: 'Recompute',
        password: 'testpass123',
      },
    })

    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-02T09:00:00.000Z',
        status: 'pending',
      },
    })
    expect(new Date(reservation.endTime as string).toISOString()).toBe('2025-08-02T10:00:00.000Z')

    // Partial update: only startTime. endTime must follow (today it stays stale).
    const updated = await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { startTime: '2025-08-02T13:00:00.000Z' },
    })
    expect(new Date(updated.endTime as string).toISOString()).toBe('2025-08-02T14:00:00.000Z')
  })

  test('PATCH startTime onto an occupied slot is rejected', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Move Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'A1 Move Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-move@example.com',
        firstName: 'A1',
        lastName: 'Move',
        password: 'testpass123',
      },
    })

    // Occupies 10:00–11:00
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-03T10:00:00.000Z',
        status: 'pending',
      },
    })
    // Free slot 14:00–15:00
    const movable = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-03T14:00:00.000Z',
        status: 'pending',
      },
    })

    await expect(
      payload.update({
        id: movable.id,
        collection: col('reservations'),
        data: { startTime: '2025-08-03T10:30:00.000Z' },
      }),
    ).rejects.toThrow()
  })

  test('PATCH guestCount over per-guest capacity is rejected', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Guest Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: {
        name: 'A1 Guest Resource (qty=4 per-guest)',
        active: true,
        capacityMode: 'per-guest',
        quantity: 4,
        services: [service.id],
      },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-guest@example.com',
        firstName: 'A1',
        lastName: 'Guest',
        password: 'testpass123',
      },
    })

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        guestCount: 2,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-04T10:00:00.000Z',
        status: 'pending',
      },
    })
    const second = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        guestCount: 2,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-04T10:00:00.000Z',
        status: 'pending',
      },
    })

    // 2 existing + 3 requested = 5 > quantity 4
    await expect(
      payload.update({
        id: second.id,
        collection: col('reservations'),
        data: { guestCount: 3 },
      }),
    ).rejects.toThrow()
  })

  test('notes-only and status-only updates never re-validate (guard for the chosen design)', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Stale Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'A1 Stale Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-stale@example.com',
        firstName: 'A1',
        lastName: 'Stale',
        password: 'testpass123',
      },
    })

    // Two valid back-to-back bookings: 10:00–11:00 and 11:00–12:00
    const first = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-05T10:00:00.000Z',
        status: 'pending',
      },
    })
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-05T11:00:00.000Z',
        status: 'pending',
      },
    })

    // Buffer added AFTER booking — re-validating either reservation would now
    // fail (10:00–11:45 window overlaps the 11:00 neighbor). Benign updates
    // must not be blocked by this.
    await payload.update({
      id: service.id,
      collection: col('services'),
      data: { bufferTimeAfter: 45 },
    })

    const withNotes = await payload.update({
      id: first.id,
      collection: col('reservations'),
      data: { notes: 'customer arrived late' },
    })
    expect(withNotes.notes).toBe('customer arrived late')

    const confirmed = await payload.update({
      id: first.id,
      collection: col('reservations'),
      data: { status: 'confirmed' },
    })
    expect(confirmed.status).toBe('confirmed')

    const completed = await payload.update({
      id: first.id,
      collection: col('reservations'),
      data: { status: 'completed' },
    })
    expect(completed.status).toBe('completed')
  })

  test('moving a reservation within its own previous window is allowed (self-exclusion)', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Self Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'A1 Self Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-self@example.com',
        firstName: 'A1',
        lastName: 'Self',
        password: 'testpass123',
      },
    })

    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-06T10:00:00.000Z',
        status: 'pending',
      },
    })

    const moved = await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { startTime: '2025-08-06T10:15:00.000Z' },
    })
    expect(new Date(moved.endTime as string).toISOString()).toBe('2025-08-06T11:15:00.000Z')
  })

  test('flexible service: PATCH startTime past the old endTime is rejected (inverted window)', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: {
        name: 'A1 Flexible Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
        durationType: 'flexible',
      },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'A1 Flexible Resource', active: true, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'a1-flexible@example.com',
        firstName: 'A1',
        lastName: 'Flexible',
        password: 'testpass123',
      },
    })

    const reservation = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        endTime: '2025-08-07T11:00:00.000Z',
        resource: resource.id,
        service: service.id,
        startTime: '2025-08-07T10:00:00.000Z',
        status: 'pending',
      },
    })

    // New start is after the kept endTime — must be rejected, not silently
    // persisted as an inverted window invisible to overlap queries.
    await expect(
      payload.update({
        id: reservation.id,
        collection: col('reservations'),
        data: { startTime: '2025-08-07T13:00:00.000Z' },
      }),
    ).rejects.toThrow()
  })
})

describe('Endpoint security (review B1/B2/B3/B6/B8)', () => {
  const futureIso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
  let secService: { id: number | string }
  let secResource: { id: number | string }
  let secCustomerA: { id: number | string }
  let secCustomerB: { id: number | string }

  beforeAll(async () => {
    secService = await payload.create({
      collection: col('services'),
      data: {
        name: 'Security Service',
        active: true,
        bufferTimeAfter: 0,
        bufferTimeBefore: 0,
        duration: 60,
      },
    })
    secResource = await payload.create({
      collection: col('resources'),
      data: { name: 'Security Resource', active: true, services: [secService.id] },
    })
    secCustomerA = await payload.create({
      collection: col('customers'),
      data: {
        email: 'security-a@example.com',
        firstName: 'Sec',
        lastName: 'A',
        password: 'testpass123',
      },
    })
    secCustomerB = await payload.create({
      collection: col('customers'),
      data: {
        email: 'security-b@example.com',
        firstName: 'Sec',
        lastName: 'B',
        password: 'testpass123',
      },
    })
  })

  const availabilityReq = (query: string, user?: Record<string, unknown>) => ({
    payload,
    url: `http://local/api/reserve/resource-availability?${query}`,
    user,
  })

  test('resource-availability requires authentication (B1)', async () => {
    const { createResourceAvailabilityEndpoint } = await import(
      '../src/endpoints/resourceAvailability.js'
    )
    const ep = createResourceAvailabilityEndpoint(resolveConfig({}))
    const query = `resource=${secResource.id}&start=2031-01-01&end=2031-01-08`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anon = await ep.handler(availabilityReq(query) as any)
    expect(anon.status).toBe(401)

    const asCustomer = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq(query, { id: secCustomerA.id, collection: 'customers' }) as any,
    )
    expect(asCustomer.status).toBe(403)

    const asAdmin = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq(query, { id: 'admin-1', collection: 'users' }) as any,
    )
    expect(asAdmin.status).toBe(200)
  })

  test('resource-availability clamps the date range and 404s unknown resources (B2/B8)', async () => {
    const { createResourceAvailabilityEndpoint } = await import(
      '../src/endpoints/resourceAvailability.js'
    )
    const ep = createResourceAvailabilityEndpoint(resolveConfig({}))
    const admin = { id: 'admin-1', collection: 'users' }

    const oversized = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq(`resource=${secResource.id}&start=2031-01-01&end=2032-01-01`, admin) as any,
    )
    expect(oversized.status).toBe(400)

    const inverted = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq(`resource=${secResource.id}&start=2031-01-08&end=2031-01-01`, admin) as any,
    )
    expect(inverted.status).toBe(400)

    const missing = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq('resource=65f000000000000000000000&start=2031-01-01&end=2031-01-08', admin) as any,
    )
    expect(missing.status).toBe(404)

    const malformed = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      availabilityReq('resource=not-an-id&start=2031-01-01&end=2031-01-08', admin) as any,
    )
    expect(malformed.status).toBe(404)
  })

  test('anonymous bookings cannot set a customer (B3)', async () => {
    const ep = createBookingEndpoint(resolveConfig({}))
    const req = {
      json: () =>
        Promise.resolve({
          customer: secCustomerA.id,
          resource: secResource.id,
          service: secService.id,
          startTime: futureIso(200),
        }),
      payload,
      t: (k: string) => k,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(403)
  })

  test('authenticated customers are forced to book for themselves (B3)', async () => {
    const ep = createBookingEndpoint(resolveConfig({}))
    const req = {
      json: () =>
        Promise.resolve({
          cancellationToken: 'attacker-chosen-token',
          customer: secCustomerB.id,
          resource: secResource.id,
          service: secService.id,
          startTime: futureIso(240),
          status: 'pending',
        }),
      payload,
      t: (k: string) => k,
      user: { id: secCustomerA.id, collection: 'customers' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(201)
    const json = (await resp.json()) as Record<string, unknown>

    const created = await payload.findByID({
      id: json.id as string,
      collection: col('reservations'),
      depth: 0,
    })
    expect(String(created.customer)).toBe(String(secCustomerA.id))
    expect(created.cancellationToken).not.toBe('attacker-chosen-token')
  })

  test('staff may book on behalf of any customer (B3 control)', async () => {
    const ep = createBookingEndpoint(resolveConfig({}))
    const req = {
      json: () =>
        Promise.resolve({
          customer: secCustomerB.id,
          resource: secResource.id,
          service: secService.id,
          startTime: futureIso(280),
          status: 'pending',
        }),
      payload,
      t: (k: string) => k,
      user: { id: 'admin-1', collection: 'users' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(201)
    const json = (await resp.json()) as Record<string, unknown>
    const created = await payload.findByID({
      id: json.id as string,
      collection: col('reservations'),
      depth: 0,
    })
    expect(String(created.customer)).toBe(String(secCustomerB.id))
  })

  test('slots endpoint rejects non-numeric guestCount and 404s unknown ids (B6/B8)', async () => {
    const { createGetSlotsEndpoint } = await import('../src/endpoints/getSlots.js')
    const ep = createGetSlotsEndpoint(resolveConfig({}))
    const mkReq = (query: string) => ({
      payload,
      url: `http://local/api/reserve/slots?${query}`,
    })

    const badGuest = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkReq(`date=2031-01-06&resource=${secResource.id}&service=${secService.id}&guestCount=abc`) as any,
    )
    expect(badGuest.status).toBe(400)

    const badService = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkReq(`date=2031-01-06&resource=${secResource.id}&service=not-an-id`) as any,
    )
    expect(badService.status).toBe(404)

    const badResource = await ep.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkReq(`date=2031-01-06&resource=not-an-id&service=${secService.id}`) as any,
    )
    expect(badResource.status).toBe(404)
  })

  test('customer search tolerates non-numeric pagination (B6)', async () => {
    const { createCustomerSearchEndpoint } = await import('../src/endpoints/customerSearch.js')
    const ep = createCustomerSearchEndpoint(resolveConfig({}))
    const resp = await ep.handler({
      payload,
      url: 'http://local/api/reservation-customer-search?search=Sec&limit=abc&page=xyz',
      user: { id: 'admin-1', collection: 'users' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    expect(resp.status).toBe(200)
  })
})

describe('Conflict detection correctness (review A3/A4/A5/A11/A12)', () => {
  const iso = (s: string) => s

  async function mkService(name: string, extra: Record<string, unknown> = {}) {
    return payload.create({
      collection: col('services'),
      data: { name, active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60, ...extra },
    })
  }
  async function mkResource(name: string, extra: Record<string, unknown> = {}) {
    return payload.create({
      collection: col('resources'),
      data: { name, active: true, services: [], ...extra },
    })
  }
  async function mkCustomer(email: string) {
    return payload.create({
      collection: col('customers'),
      data: { email, firstName: 'CD', lastName: 'Test', password: 'testpass123' },
    })
  }

  test('A3: a neighbor service bufferTimeAfter blocks a back-to-back booking', async () => {
    const service = await mkService('A3 After Service', { bufferTimeAfter: 30 })
    const resource = await mkResource('A3 After Resource', { services: [service.id] })
    const customer = await mkCustomer('a3-after@example.com')

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-01T10:00:00.000Z'),
        status: 'pending',
      },
    })

    // 11:00 is inside the existing booking's 30-min after-buffer (until 11:30)
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: iso('2030-09-01T11:00:00.000Z'),
          status: 'pending',
        },
      }),
    ).rejects.toThrow()

    // 11:30 clears the buffer
    const ok = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-01T11:30:00.000Z'),
        status: 'pending',
      },
    })
    expect(ok.id).toBeDefined()
  })

  test('A4: a multi-item booking only blocks each resource for its own item window', async () => {
    const service = await mkService('A4 Service')
    const roomA = await mkResource('A4 Room A', { services: [service.id] })
    const roomB = await mkResource('A4 Room B', { services: [service.id] })
    const customer = await mkCustomer('a4@example.com')

    // package: room A 09:00-10:00, room B 14:00-15:00 (top-level span 09:00-15:00)
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        items: [
          { resource: roomA.id, service: service.id, startTime: iso('2030-09-02T09:00:00.000Z') },
          { resource: roomB.id, service: service.id, startTime: iso('2030-09-02T14:00:00.000Z') },
        ],
        resource: roomA.id,
        service: service.id,
        startTime: iso('2030-09-02T09:00:00.000Z'),
        status: 'pending',
      },
    })

    // room A at 12:00 is free (its item ended 10:00) — must be allowed
    const ok = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: roomA.id,
        service: service.id,
        startTime: iso('2030-09-02T12:00:00.000Z'),
        status: 'pending',
      },
    })
    expect(ok.id).toBeDefined()

    // room A at 09:30 overlaps its 09:00-10:00 item — must be rejected
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: roomA.id,
          service: service.id,
          startTime: iso('2030-09-02T09:30:00.000Z'),
          status: 'pending',
        },
      }),
    ).rejects.toThrow()
  })

  test('A5: two items in one create on the same resource cannot overlap', async () => {
    const service = await mkService('A5 Service')
    const resource = await mkResource('A5 Resource', { services: [service.id] })
    const customer = await mkCustomer('a5@example.com')

    // both items resource R, 10:00 and 10:30, 60-min service → overlap
    await expect(
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          items: [
            { resource: resource.id, service: service.id, startTime: iso('2030-09-03T10:00:00.000Z') },
            { resource: resource.id, service: service.id, startTime: iso('2030-09-03T10:30:00.000Z') },
          ],
          resource: resource.id,
          service: service.id,
          startTime: iso('2030-09-03T10:00:00.000Z'),
          status: 'pending',
        },
      }),
    ).rejects.toThrow()

    // non-overlapping siblings (10:00 and 11:00) are fine
    const ok = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        items: [
          { resource: resource.id, service: service.id, startTime: iso('2030-09-04T10:00:00.000Z') },
          { resource: resource.id, service: service.id, startTime: iso('2030-09-04T11:00:00.000Z') },
        ],
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-04T10:00:00.000Z'),
        status: 'pending',
      },
    })
    expect(ok.id).toBeDefined()
  })

  test('A5: overlapping siblings allowed when resource quantity covers them', async () => {
    const service = await mkService('A5 Qty Service')
    const resource = await mkResource('A5 Qty Resource', {
      capacityMode: 'per-reservation',
      quantity: 2,
      services: [service.id],
    })
    const customer = await mkCustomer('a5-qty@example.com')

    const ok = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        items: [
          { resource: resource.id, service: service.id, startTime: iso('2030-09-05T10:00:00.000Z') },
          { resource: resource.id, service: service.id, startTime: iso('2030-09-05T10:30:00.000Z') },
        ],
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-05T10:00:00.000Z'),
        status: 'pending',
      },
    })
    expect(ok.id).toBeDefined()
  })

  test('back-to-back zero-buffer bookings are still allowed (regression)', async () => {
    const service = await mkService('B2B Service')
    const resource = await mkResource('B2B Resource', { services: [service.id] })
    const customer = await mkCustomer('b2b-cd@example.com')

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-06T10:00:00.000Z'),
        status: 'pending',
      },
    })
    const ok = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: iso('2030-09-06T11:00:00.000Z'),
        status: 'pending',
      },
    })
    expect(ok.id).toBeDefined()
  })

  test('A11: an exception on one of a resource’s schedules blocks the whole resource that day', async () => {
    const { getAvailableSlots } = await import('../src/services/AvailabilityService.js')
    const service = await mkService('A11 Service')
    const resource = await mkResource('A11 Resource', { services: [service.id] })

    // recurring weekday schedule
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'A11 Recurring',
        active: true,
        recurringSlots: [{ day: 'wed', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })
    // separate schedule carrying a vacation exception for one Wednesday
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'A11 Exception Holder',
        active: true,
        exceptions: [{ date: '2030-09-11T00:00:00.000Z', type: 'vacation' }],
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
    }

    // 2030-09-11 is a Wednesday AND the exception day → no slots
    const blocked = await getAvailableSlots({ ...base, date: '2030-09-11' })
    expect(blocked).toHaveLength(0)

    // the following Wednesday is open
    const open = await getAvailableSlots({ ...base, date: '2030-09-18' })
    expect(open.length).toBeGreaterThan(0)
  })
})

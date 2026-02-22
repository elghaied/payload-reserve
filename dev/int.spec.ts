import type { Access, Field, Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'

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

  it('full-day durationType: endTime is set to local end-of-day (23:59:59)', async () => {
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

    // Use local-time midnight as startTime to ensure same-day behaviour
    const startLocal = new Date(2030, 4, 15, 8, 0, 0, 0) // May 15 2030 08:00 local
    const res = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerId,
        resource: fullDayResource.id,
        service: service.id,
        startTime: startLocal.toISOString(),
        status: 'pending',
      },
    })

    const endTime = new Date(res.endTime as string)
    // computeEndTime for full-day uses setHours(23,59,59,999) (local time)
    expect(endTime.getHours()).toBe(23)
    expect(endTime.getMinutes()).toBe(59)
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

  // Build a Monday date using local-time constructor (month is 0-indexed).
  // April 8 2030 is a confirmed Monday. Using new Date(y,m,d) ensures getDay()
  // returns 1 (Monday) regardless of the host timezone.
  const MONDAY_LOCAL = new Date(2030, 3, 8) // Mon Apr 08 2030 00:00:00 (local)

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

    // Schedule is 09:00–12:00 local, slots are 1h each → 3 slots
    expect(slots.length).toBe(3)
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

    expect(remainingSlots.length).toBe(initialSlots.length - 1)
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

  it('computeEndTime: full-day returns end of the same day (23:59:59)', async () => {
    const { computeEndTime } = await import('../src/services/AvailabilityService.js')
    const start = new Date('2030-01-01T06:00:00.000Z')
    const result = computeEndTime({ durationType: 'full-day', serviceDuration: 0, startTime: start })
    expect(result.endTime.getHours()).toBe(23)
    expect(result.endTime.getMinutes()).toBe(59)
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

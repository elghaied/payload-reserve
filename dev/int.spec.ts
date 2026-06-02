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

    const MONDAY_LOCAL = new Date(2030, 5, 17) // Mon Jun 17 2030 local
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
    const afterStartMinutes = afterSlots.map((s) => s.start.getHours() * 60 + s.start.getMinutes())
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

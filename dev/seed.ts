import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

export const seed = async (payload: Payload) => {
  // Seed dev user
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: { email: { equals: devUser.email } },
  })

  if (!totalDocs) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }

  // Under multi-tenant mode the base salon/guest-booking demo entities have no
  // `tenant` (the multi-tenant plugin makes that field required), so creating
  // them would fail validation and abort onInit. Skip the base demo entirely and
  // seed only the multi-tenant fixtures.
  if (process.env.MT) {
    await seedMultiTenant(payload)
    return
  }

  // ---- GUEST BOOKING DEMO (idempotent) ----
  // Minimal service + resource + schedule for the public /book page. Runs even
  // when the rest of the seed is skipped, so /book always has something to book.
  const tourName = 'Studio Tour'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { totalDocs: tourExists } = await (payload.count as any)({
    collection: 'services',
    where: { name: { equals: tourName } },
  })
  if (!tourExists) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tour = await (payload.create as any)({
      collection: 'services',
      data: {
        name: tourName,
        active: true,
        allowGuestBooking: 'enabled',
        description: 'Guided studio tour — book without an account',
        duration: 30,
        durationType: 'fixed',
        price: 0,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const studio = await (payload.create as any)({
      collection: 'resources',
      data: { name: 'Main Studio', active: true, services: [tour.id] },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.create as any)({
      collection: 'schedules',
      data: {
        name: 'Main Studio - Open Hours',
        active: true,
        recurringSlots: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({
          day,
          endTime: '20:00',
          startTime: '08:00',
        })),
        resource: studio.id,
        scheduleType: 'recurring',
      },
    })
    payload.logger.info('Seeded guest-booking demo: "Studio Tour" @ "Main Studio" → visit /book')
  }

  // Skip the rest if reservation data already seeded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { totalDocs: existingServices } = await (payload.count as any)({
    collection: 'services',
  })
  if (existingServices > 1) { return }

  // ---- SERVICES ----

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (collection: string, data: Record<string, unknown>) => (payload.create as any)({ collection, data })

  const haircut = await create('services', {
    name: 'Haircut',
    active: true,
    bufferTimeAfter: 10,
    bufferTimeBefore: 5,
    description: 'Standard haircut service',
    duration: 30,
    durationType: 'fixed',
    price: 35,
  })

  const coloring = await create('services', {
    name: 'Hair Coloring',
    active: true,
    bufferTimeAfter: 15,
    bufferTimeBefore: 10,
    description: 'Full hair coloring service',
    duration: 90,
    durationType: 'fixed',
    price: 120,
  })

  const consultation = await create('services', {
    name: 'Consultation',
    active: true,
    bufferTimeAfter: 5,
    bufferTimeBefore: 0,
    description: 'Initial consultation',
    duration: 15,
    durationType: 'fixed',
    price: 0,
  })

  const massage = await create('services', {
    name: 'Swedish Massage',
    active: true,
    bufferTimeAfter: 15,
    bufferTimeBefore: 5,
    description: '60-minute Swedish massage session',
    duration: 60,
    durationType: 'fixed',
    price: 85,
  })

  const groupYoga = await create('services', {
    name: 'Group Yoga Session',
    active: true,
    bufferTimeAfter: 10,
    bufferTimeBefore: 0,
    description: '45-minute group yoga class, up to 20 participants',
    duration: 45,
    durationType: 'fixed',
    price: 20,
  })

  const eventSpace = await create('services', {
    name: 'Event Space Rental',
    active: true,
    bufferTimeAfter: 30,
    bufferTimeBefore: 15,
    description: 'Flexible-duration event space rental (minimum 2 hours)',
    duration: 120,
    durationType: 'flexible',
    price: 200,
  })

  const fullDayRetreat = await create('services', {
    name: 'Full Day Wellness Retreat',
    active: true,
    bufferTimeAfter: 0,
    bufferTimeBefore: 0,
    description: 'Full-day wellness retreat package',
    duration: 1,
    durationType: 'full-day',
    price: 350,
  })

  // ---- RESOURCES ----

  const alice = await create('resources', {
    name: 'Alice Johnson',
    active: true,
    description: 'Senior Stylist',
    services: [haircut.id, coloring.id, consultation.id],
  })

  const bob = await create('resources', {
    name: 'Bob Smith',
    active: true,
    description: 'Junior Stylist',
    services: [haircut.id, consultation.id],
  })

  // Multi-unit resource: 5 massage tables (per-reservation capacity)
  const massageTable = await create('resources', {
    name: 'Massage Table',
    active: true,
    capacityMode: 'per-reservation',
    description: 'Private massage table — 5 available',
    quantity: 5,
    services: [massage.id],
  })

  // Group capacity resource: yoga room (per-guest capacity, 20 max)
  const yogaRoom = await create('resources', {
    name: 'Yoga Class Room',
    active: true,
    capacityMode: 'per-guest',
    description: 'Group yoga studio — 20 participant capacity',
    quantity: 20,
    services: [groupYoga.id],
  })

  // Multi-purpose event room (flexible + full-day services)
  const eventRoom = await create('resources', {
    name: 'Event Room',
    active: true,
    description: 'Multi-purpose event room for rentals and retreats',
    services: [eventSpace.id, fullDayRetreat.id],
  })

  // ---- CUSTOMERS ----

  const customer1 = await create('customers', {
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    notes: 'Prefers morning appointments',
    password: 'customer123',
    phone: '555-0101',
  })

  const customer2 = await create('customers', {
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Public',
    password: 'customer123',
    phone: '555-0202',
  })

  // ---- SCHEDULES ----

  const today = new Date()
  const exceptionDate1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10)
  const exceptionDate2 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 20)
  const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)
  const weekAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14)

  await create('schedules', {
    name: 'Alice - Weekday Schedule',
    active: true,
    exceptions: [
      { date: exceptionDate1.toISOString(), reason: 'Vacation day' },
      { date: exceptionDate2.toISOString(), reason: 'Training seminar' },
    ],
    recurringSlots: [
      { day: 'mon', endTime: '17:00', startTime: '09:00' },
      { day: 'tue', endTime: '17:00', startTime: '09:00' },
      { day: 'wed', endTime: '17:00', startTime: '09:00' },
      { day: 'thu', endTime: '17:00', startTime: '09:00' },
      { day: 'fri', endTime: '15:00', startTime: '09:00' },
    ],
    resource: alice.id,
    scheduleType: 'recurring',
  })

  await create('schedules', {
    name: 'Bob - Weekday Schedule',
    active: true,
    exceptions: [],
    recurringSlots: [
      { day: 'mon', endTime: '18:00', startTime: '10:00' },
      { day: 'wed', endTime: '18:00', startTime: '10:00' },
      { day: 'fri', endTime: '18:00', startTime: '10:00' },
      { day: 'sat', endTime: '14:00', startTime: '09:00' },
    ],
    resource: bob.id,
    scheduleType: 'recurring',
  })

  await create('schedules', {
    name: 'Massage Table - Weekday Schedule',
    active: true,
    exceptions: [],
    recurringSlots: [
      { day: 'mon', endTime: '19:00', startTime: '09:00' },
      { day: 'tue', endTime: '19:00', startTime: '09:00' },
      { day: 'wed', endTime: '19:00', startTime: '09:00' },
      { day: 'thu', endTime: '19:00', startTime: '09:00' },
      { day: 'fri', endTime: '17:00', startTime: '09:00' },
    ],
    resource: massageTable.id,
    scheduleType: 'recurring',
  })

  await create('schedules', {
    name: 'Yoga Room - Daily Schedule',
    active: true,
    exceptions: [],
    recurringSlots: [
      { day: 'mon', endTime: '20:00', startTime: '07:00' },
      { day: 'tue', endTime: '20:00', startTime: '07:00' },
      { day: 'wed', endTime: '20:00', startTime: '07:00' },
      { day: 'thu', endTime: '20:00', startTime: '07:00' },
      { day: 'fri', endTime: '20:00', startTime: '07:00' },
      { day: 'sat', endTime: '14:00', startTime: '08:00' },
      { day: 'sun', endTime: '12:00', startTime: '08:00' },
    ],
    resource: yogaRoom.id,
    scheduleType: 'recurring',
  })

  await create('schedules', {
    name: 'Event Room - Available Dates',
    active: true,
    exceptions: [],
    manualSlots: [
      { date: nextWeek.toISOString(), endTime: '22:00', startTime: '08:00' },
      { date: weekAfter.toISOString(), endTime: '22:00', startTime: '08:00' },
    ],
    resource: eventRoom.id,
    scheduleType: 'manual',
  })

  // ---- RESERVATIONS ----

  const makeTime = (hour: number, minute = 0) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute).toISOString()

  // Single-resource reservation → confirmed via status transition
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reservation1 = await (payload.create as any)({
    collection: 'reservations',
    data: {
      customer: customer1.id,
      idempotencyKey: 'seed-booking-001',
      resource: alice.id,
      service: haircut.id,
      startTime: makeTime(9, 0),
      status: 'pending',
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.update as any)({
    id: reservation1.id,
    collection: 'reservations',
    data: { status: 'confirmed' },
  })

  // Pending reservation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.create as any)({
    collection: 'reservations',
    data: {
      customer: customer2.id,
      resource: bob.id,
      service: consultation.id,
      startTime: makeTime(10, 0),
      status: 'pending',
    },
  })

  // Another pending reservation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.create as any)({
    collection: 'reservations',
    data: {
      customer: customer2.id,
      resource: alice.id,
      service: coloring.id,
      startTime: makeTime(14, 0),
      status: 'pending',
    },
  })

  // Multi-resource reservation (uses items array; skip hooks to avoid conflict check during seed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.create as any)({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      customer: customer1.id,
      items: [
        {
          endTime: makeTime(11, 30),
          resource: alice.id,
          service: haircut.id,
          startTime: makeTime(11, 0),
        },
        {
          endTime: makeTime(11, 15),
          resource: bob.id,
          service: consultation.id,
          startTime: makeTime(11, 0),
        },
      ],
      notes: 'Back-to-back services with two stylists',
      resource: alice.id,
      service: haircut.id,
      startTime: makeTime(11, 0),
      status: 'confirmed',
    },
  })

  // Group yoga reservation (guestCount=4; per-guest capacity test)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.create as any)({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      customer: customer2.id,
      guestCount: 4,
      notes: 'Group booking for yoga class',
      resource: yogaRoom.id,
      service: groupYoga.id,
      startTime: makeTime(8, 0),
      status: 'confirmed',
    },
  })

  // Flexible-duration reservation (event space rental with explicit endTime)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload.create as any)({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      customer: customer1.id,
      endTime: new Date(nextWeek.getFullYear(), nextWeek.getMonth(), nextWeek.getDate(), 14, 0).toISOString(),
      notes: 'Corporate team-building event (3 hours)',
      resource: eventRoom.id,
      service: eventSpace.id,
      startTime: new Date(nextWeek.getFullYear(), nextWeek.getMonth(), nextWeek.getDate(), 11, 0).toISOString(),
      status: 'confirmed',
    },
  })

  // ---- GUEST RESERVATIONS (account-less; for testing email + OTP cancellation) ----
  // Scheduled next week so they're outside the 24h cancellation notice window.
  const guestSlot = (hour: number) =>
    new Date(nextWeek.getFullYear(), nextWeek.getMonth(), nextWeek.getDate(), hour, 0).toISOString()

  // Guest with EMAIL → afterBookingCreate emails a cancel link (see dev console).
  await create('reservations', {
    guest: { name: 'Guest Emailer', email: 'guest.email@example.com' },
    resource: bob.id,
    service: consultation.id,
    startTime: guestSlot(15),
  })

  // Guest with PHONE → cancel via OTP:
  //   POST /api/dev/request-cancel-otp { reservationId }  → code logged to console
  //   POST /api/dev/confirm-cancel-otp { reservationId, code }
  await create('reservations', {
    guest: { name: 'Guest Caller', phone: '+15551230000' },
    resource: bob.id,
    service: consultation.id,
    startTime: guestSlot(16),
  })

  payload.logger.info(`
    ✅ Seed complete!
       Admin:     ${devUser.email} / ${devUser.password}
       Customers: jane@example.com / customer123
                  john@example.com / customer123
       Guest bookings seeded (next week): email + phone, for cancel testing
  `)

}

// ---- MULTI-TENANT DEMO (opt-in via MT env var) ----
// Seeds two tenants, a super-admin dev user assigned to both, and one
// service/resource/reservation per tenant. Runs instead of the base salon demo
// because under multi-tenant the `tenant` field is required on those collections.
const seedMultiTenant = async (payload: Payload) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payloadAny = payload as any

    // Ensure two tenants exist (idempotent by name)
    const { docs: existingTenants } = await payloadAny.find({
      collection: 'tenants',
      where: { name: { in: ['Tenant A', 'Tenant B'] } },
    })

    const findOrCreateTenant = (name: string) => {
      const existing = (existingTenants as Array<{ id: string; name: string }>).find(
        (t) => t.name === name,
      )
      if (existing) {return Promise.resolve(existing)}
      return payloadAny.create({ collection: 'tenants', data: { name } })
    }

    const tenantA = await findOrCreateTenant('Tenant A')
    const tenantB = await findOrCreateTenant('Tenant B')

    // Set the dev user as superAdmin with access to both tenants
    const { docs: devUsers } = await payloadAny.find({
      collection: 'users',
      where: { email: { equals: devUser.email } },
    })
    if (devUsers.length > 0) {
      await payloadAny.update({
        id: devUsers[0].id,
        collection: 'users',
        data: {
          superAdmin: true,
          tenants: [{ tenant: tenantA.id }, { tenant: tenantB.id }],
        },
      })
    }

    // Create one service per tenant (find-or-create by name)
    const findOrCreateService = async (name: string, tenantId: string) => {
      const { docs } = await payloadAny.find({
        collection: 'services',
        where: { name: { equals: name } },
      })
      if (docs.length > 0) {return docs[0]}
      return payloadAny.create({
        collection: 'services',
        data: {
          name,
          active: true,
          duration: 30,
          durationType: 'fixed',
          price: 0,
          tenant: tenantId,
        },
      })
    }

    const serviceA = await findOrCreateService('A Service', tenantA.id)
    const serviceB = await findOrCreateService('B Service', tenantB.id)

    // Create one resource per tenant (find-or-create by name)
    const findOrCreateResource = async (name: string, tenantId: string) => {
      const { docs } = await payloadAny.find({
        collection: 'resources',
        where: { name: { equals: name } },
      })
      if (docs.length > 0) {return docs[0]}
      return payloadAny.create({
        collection: 'resources',
        data: { name, active: true, tenant: tenantId },
      })
    }

    const resourceA = await findOrCreateResource('A Room', tenantA.id)
    const resourceB = await findOrCreateResource('B Room', tenantB.id)

    // Create one reservation per tenant (find-or-create by idempotencyKey)
    const todayNoon = new Date()
    todayNoon.setHours(12, 0, 0, 0)

    const findOrCreateReservation = async (
      idempotencyKey: string,
      data: Record<string, unknown>,
    ) => {
      const { docs } = await payloadAny.find({
        collection: 'reservations',
        where: { idempotencyKey: { equals: idempotencyKey } },
      })
      if (docs.length > 0) {return docs[0]}
      return payloadAny.create({
        collection: 'reservations',
        context: { skipReservationHooks: true },
        data,
      })
    }

    await findOrCreateReservation('mt-seed-tenant-a-001', {
      idempotencyKey: 'mt-seed-tenant-a-001',
      resource: resourceA.id,
      service: serviceA.id,
      startTime: todayNoon.toISOString(),
      status: 'pending',
      tenant: tenantA.id,
    })

    await findOrCreateReservation('mt-seed-tenant-b-001', {
      idempotencyKey: 'mt-seed-tenant-b-001',
      resource: resourceB.id,
      service: serviceB.id,
      startTime: todayNoon.toISOString(),
      status: 'pending',
      tenant: tenantB.id,
    })

    payload.logger.info(
      '[MT] Multi-tenant seed complete: Tenant A + Tenant B with services, resources, and reservations.',
    )
  } catch (err) {
    payload.logger.warn({ err, msg: '[MT] Multi-tenant seed failed — continuing without MT data' })
  }
}

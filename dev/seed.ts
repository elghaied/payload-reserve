import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

export const seed = async (payload: Payload) => {
  // Seed dev user
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!totalDocs) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }

  // Check if reservation data already seeded
  const { totalDocs: existingServices } = await payload.count({
    collection: 'services' as 'users',
  })
  if (existingServices > 0) {return}

  // Seed services
  const haircut = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Haircut',
      active: true,
      bufferTimeAfter: 10,
      bufferTimeBefore: 5,
      description: 'Standard haircut service',
      duration: 30,
      durationType: 'fixed',
      price: 35,
    },
  })

  const coloring = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Hair Coloring',
      active: true,
      bufferTimeAfter: 15,
      bufferTimeBefore: 10,
      description: 'Full hair coloring service',
      duration: 90,
      durationType: 'fixed',
      price: 120,
    },
  })

  const consultation = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Consultation',
      active: true,
      bufferTimeAfter: 5,
      bufferTimeBefore: 0,
      description: 'Initial consultation',
      duration: 15,
      durationType: 'fixed',
      price: 0,
    },
  })

  // Seed resources
  const alice = await payload.create({
    collection: 'resources' as 'users',
    data: {
      name: 'Alice Johnson',
      active: true,
      description: 'Senior Stylist',
      services: [haircut.id, coloring.id, consultation.id],
    },
  })

  const bob = await payload.create({
    collection: 'resources' as 'users',
    data: {
      name: 'Bob Smith',
      active: true,
      description: 'Junior Stylist',
      services: [haircut.id, consultation.id],
    },
  })

  // Date helpers (used for schedules, reservations, and exception dates)
  const today = new Date()
  const makeTime = (hour: number, minute: number = 0) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute)
    return d.toISOString()
  }

  // Seed additional services (flexible + full-day duration types)
  const eventSpace = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Event Space Rental',
      active: true,
      bufferTimeAfter: 30,
      bufferTimeBefore: 15,
      description: 'Flexible-duration event space rental (minimum 2 hours)',
      duration: 120,
      durationType: 'flexible',
      price: 200,
    },
  })

  const fullDayRetreat = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Full Day Wellness Retreat',
      active: true,
      bufferTimeAfter: 0,
      bufferTimeBefore: 0,
      description: 'Full-day wellness retreat package',
      duration: 1,
      durationType: 'full-day',
      price: 350,
    },
  })

  // Seed schedules
  // Helper dates for exception dates and manual schedules
  const exceptionDate1 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10)
  const exceptionDate2 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 20)

  await payload.create({
    collection: 'schedules' as 'users',
    data: {
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
    },
  })

  await payload.create({
    collection: 'schedules' as 'users',
    data: {
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
    },
  })

  // Seed customers (dedicated auth collection)
  const customer1 = await payload.create({
    collection: 'customers' as 'users',
    data: {
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      notes: 'Prefers morning appointments',
      password: 'customer123',
      phone: '555-0101',
    },
  })

  const customer2 = await payload.create({
    collection: 'customers' as 'users',
    data: {
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Public',
      password: 'customer123',
      phone: '555-0202',
    },
  })

  // Seed some reservations for today
  const reservation1 = await payload.create({
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

  await payload.update({
    id: reservation1.id,
    collection: 'reservations',
    data: { status: 'confirmed' },
  })

  await payload.create({
    collection: 'reservations',
    data: {
      customer: customer2.id,
      resource: bob.id,
      service: consultation.id,
      startTime: makeTime(10, 0),
      status: 'pending',
    },
  })

  await payload.create({
    collection: 'reservations',
    data: {
      customer: customer2.id,
      resource: alice.id,
      service: coloring.id,
      startTime: makeTime(14, 0),
      status: 'pending',
    },
  })

  // --- New: multi-unit and capacity resources ---

  // Service for massage (fixed duration, no group capacity)
  const massage = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Swedish Massage',
      active: true,
      bufferTimeAfter: 15,
      bufferTimeBefore: 5,
      description: '60-minute Swedish massage session',
      duration: 60,
      durationType: 'fixed',
      price: 85,
    },
  })

  // Service for group yoga (fixed duration, per-guest capacity)
  const groupYoga = await payload.create({
    collection: 'services' as 'users',
    data: {
      name: 'Group Yoga Session',
      active: true,
      bufferTimeAfter: 10,
      bufferTimeBefore: 0,
      description: '45-minute group yoga class, up to 20 participants',
      duration: 45,
      durationType: 'fixed',
      price: 20,
    },
  })

  // Multi-unit resource: 5 massage tables (per-reservation capacity)
  const massageTable = await payload.create({
    collection: 'resources' as 'users',
    data: {
      name: 'Massage Table',
      active: true,
      capacityMode: 'per-reservation',
      description: 'Private massage table — 5 available',
      quantity: 5,
      services: [massage.id],
    },
  })

  // Capacity resource: yoga room with 20-person per-guest capacity
  const yogaRoom = await payload.create({
    collection: 'resources' as 'users',
    data: {
      name: 'Yoga Class Room',
      active: true,
      capacityMode: 'per-guest',
      description: 'Group yoga studio — 20 participant capacity',
      quantity: 20,
      services: [groupYoga.id],
    },
  })

  // Event room resource (for flexible + full-day services)
  const eventRoom = await payload.create({
    collection: 'resources' as 'users',
    data: {
      name: 'Event Room',
      active: true,
      description: 'Multi-purpose event room for rentals and retreats',
      services: [eventSpace.id, fullDayRetreat.id],
    },
  })

  // Schedule for the yoga room (daily classes)
  await payload.create({
    collection: 'schedules' as 'users',
    data: {
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
    },
  })

  // Schedule for massage tables (weekdays)
  await payload.create({
    collection: 'schedules' as 'users',
    data: {
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
    },
  })

  // Schedule for event room (manual slots — specific dates)
  const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)
  const weekAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14)

  await payload.create({
    collection: 'schedules' as 'users',
    data: {
      name: 'Event Room - Available Dates',
      active: true,
      exceptions: [],
      manualSlots: [
        { date: nextWeek.toISOString(), endTime: '22:00', startTime: '08:00' },
        { date: weekAfter.toISOString(), endTime: '22:00', startTime: '08:00' },
      ],
      resource: eventRoom.id,
      scheduleType: 'manual',
    },
  })

  // Multi-resource reservation: books Alice (haircut) and Bob (consultation) at the same time
  // Uses items array; skipReservationHooks to bypass conflict checks during seeding
  await payload.create({
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

  // Reservation with guestCount: 4 guests attending a yoga class
  // skipReservationHooks to avoid potential schedule/conflict validation during seeding
  await payload.create({
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

  // Flexible-duration reservation: event space rental with explicit endTime
  await payload.create({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      customer: customer1.id,
      endTime: new Date(
        nextWeek.getFullYear(),
        nextWeek.getMonth(),
        nextWeek.getDate(),
        14,
        0,
      ).toISOString(),
      notes: 'Corporate team-building event (3 hours)',
      resource: eventRoom.id,
      service: eventSpace.id,
      startTime: new Date(
        nextWeek.getFullYear(),
        nextWeek.getMonth(),
        nextWeek.getDate(),
        11,
        0,
      ).toISOString(),
      status: 'confirmed',
    },
  })

  payload.logger.info('Reservation plugin: seed data created successfully')
}

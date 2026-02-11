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
    collection: 'reservation-services' as 'users',
  })
  if (existingServices > 0) {return}

  // Seed services
  const haircut = await payload.create({
    collection: 'reservation-services' as 'users',
    data: {
      name: 'Haircut',
      active: true,
      bufferTimeAfter: 10,
      bufferTimeBefore: 5,
      description: 'Standard haircut service',
      duration: 30,
      price: 35,
    },
  })

  const coloring = await payload.create({
    collection: 'reservation-services' as 'users',
    data: {
      name: 'Hair Coloring',
      active: true,
      bufferTimeAfter: 15,
      bufferTimeBefore: 10,
      description: 'Full hair coloring service',
      duration: 90,
      price: 120,
    },
  })

  const consultation = await payload.create({
    collection: 'reservation-services' as 'users',
    data: {
      name: 'Consultation',
      active: true,
      bufferTimeAfter: 5,
      bufferTimeBefore: 0,
      description: 'Initial consultation',
      duration: 15,
      price: 0,
    },
  })

  // Seed resources
  const alice = await payload.create({
    collection: 'reservation-resources' as 'users',
    data: {
      name: 'Alice Johnson',
      active: true,
      description: 'Senior Stylist',
      services: [haircut.id, coloring.id, consultation.id],
    },
  })

  const bob = await payload.create({
    collection: 'reservation-resources' as 'users',
    data: {
      name: 'Bob Smith',
      active: true,
      description: 'Junior Stylist',
      services: [haircut.id, consultation.id],
    },
  })

  // Seed schedules
  await payload.create({
    collection: 'reservation-schedules' as 'users',
    data: {
      name: 'Alice - Weekday Schedule',
      active: true,
      exceptions: [],
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
    collection: 'reservation-schedules' as 'users',
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

  // Seed customers
  const customer1 = await payload.create({
    collection: 'reservation-customers' as 'users',
    data: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      notes: 'Prefers morning appointments',
      phone: '555-0101',
    },
  })

  const customer2 = await payload.create({
    collection: 'reservation-customers' as 'users',
    data: {
      name: 'John Public',
      email: 'john@example.com',
      phone: '555-0202',
    },
  })

  // Seed some reservations for today
  const today = new Date()
  const makeTime = (hour: number, minute: number = 0) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute)
    return d.toISOString()
  }

  const reservation1 = await payload.create({
    collection: 'reservations' as 'users',
    data: {
      customer: customer1.id,
      resource: alice.id,
      service: haircut.id,
      startTime: makeTime(9, 0),
      status: 'pending',
    },
  })

  await payload.update({
    id: reservation1.id,
    collection: 'reservations' as 'users',
    data: { status: 'confirmed' },
  })

  await payload.create({
    collection: 'reservations' as 'users',
    data: {
      customer: customer2.id,
      resource: bob.id,
      service: consultation.id,
      startTime: makeTime(10, 0),
      status: 'pending',
    },
  })

  await payload.create({
    collection: 'reservations' as 'users',
    data: {
      customer: customer2.id,
      resource: alice.id,
      service: coloring.id,
      startTime: makeTime(14, 0),
      status: 'pending',
    },
  })

  payload.logger.info('Reservation plugin: seed data created successfully')
}

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

const col = (slug: string) => slug as 'users'

async function seed(tag: string) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Delete Service ${tag}`, active: true, duration: 60 },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Delete Resource ${tag}`, active: true, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `delete-${tag}@example.com`,
      firstName: 'Delete',
      lastName: tag,
      password: 'test1234',
    },
  })
  return { customer, resource, service }
}

describe('deleting a referenced service or resource', () => {
  test('a service with reservations cannot be deleted, and says why', async () => {
    const { customer, resource, service } = await seed('svc')
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2027-05-01T10:00:00.000Z',
        status: 'pending',
      },
    })

    await expect(
      payload.delete({ id: service.id, collection: col('services') }),
    ).rejects.toThrow(/1 reservation/i)

    // Still there — the guard rejected rather than partially applying.
    const still = await payload.findByID({ id: service.id, collection: col('services') })
    expect(still.id).toBe(service.id)
  })

  test('a resource with reservations cannot be deleted', async () => {
    const { customer, resource, service } = await seed('res')
    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2027-05-02T10:00:00.000Z',
        status: 'pending',
      },
    })

    await expect(
      payload.delete({ id: resource.id, collection: col('resources') }),
    ).rejects.toThrow(/reservation/i)
  })

  test('an UNreferenced service deletes normally', async () => {
    const { service } = await seed('free')
    const deleted = await payload.delete({ id: service.id, collection: col('services') })
    expect(deleted).toBeDefined()
  })

  // A multi-resource booking can reference a resource ONLY through items[],
  // never at the top level. Missing that clause would let the guard pass
  // while leaving exactly the dangling reference it exists to prevent.
  test('a resource referenced only through items[] cannot be deleted', async () => {
    const { customer, resource: topResource, service } = await seed('items-top')
    const itemsOnlyResource = await payload.create({
      collection: col('resources'),
      data: { name: 'Delete Resource items-only', active: true, services: [service.id] },
    })

    await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        items: [
          {
            resource: itemsOnlyResource.id,
            service: service.id,
            startTime: '2027-05-03T14:00:00.000Z',
          },
        ],
        resource: topResource.id,
        service: service.id,
        startTime: '2027-05-03T10:00:00.000Z',
        status: 'pending',
      },
    })

    await expect(
      payload.delete({ id: itemsOnlyResource.id, collection: col('resources') }),
    ).rejects.toThrow(/reservation/i)
  })

  // Schedules.resource is also required: true — same NOT NULL / ON DELETE SET
  // NULL contradiction as Reservations, one relationship over. A resource can
  // be scheduled with zero reservations against it; the guard must still
  // block the delete, and name "schedule" rather than a generic message.
  test('a resource with schedules but zero reservations cannot be deleted, and says so', async () => {
    const { resource } = await seed('sched')
    await payload.create({
      collection: col('schedules'),
      data: { name: 'Delete Schedule sched', resource: resource.id },
    })

    await expect(
      payload.delete({ id: resource.id, collection: col('resources') }),
    ).rejects.toThrow(/1 schedule/i)

    // Still there — the guard rejected rather than partially applying.
    const still = await payload.findByID({ id: resource.id, collection: col('resources') })
    expect(still.id).toBe(resource.id)
  })
})

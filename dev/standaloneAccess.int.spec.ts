import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildAvailabilityReasonPayload } from './helpers/availabilityReasonPayload.js'

/**
 * Standalone mode (`payloadReserve()` with no options, the Quick Start config)
 * used to leave Reservations and the generated Customers auth collection on
 * Payload's default access — `Boolean(user)` for read/update/delete. A customer
 * with a login could then, through the stock collection REST API, read, rewrite
 * and delete every other customer's reservation, list every customer's
 * name/email/phone/notes, and PATCH another customer's password and log in as
 * them. Reported privately against 4.1.0; every case below reproduced before
 * the fix. Access checks are on (`overrideAccess: false` + `user`), which is
 * exactly what the REST API does.
 */

let payload: Payload
let stop: () => Promise<void>

type Doc = { id: number | string } & Record<string, unknown>
const asCustomer = (c: Doc) => ({ ...c, collection: 'customers' }) as never
const asStaff = { id: 'staff-1', collection: 'users' } as never

let customerA: Doc
let customerB: Doc
let reservationA: Doc
let guestReservation: Doc
let serviceId: number | string
let resourceId: number | string

const futureIso = (daysAhead: number, hour = 9) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

beforeAll(async () => {
  const built = await buildAvailabilityReasonPayload('standaloneaccessmemory')
  payload = built.payload
  stop = built.stop

  customerA = (await payload.create({
    collection: 'customers',
    data: {
      email: 'sa-a@example.com',
      firstName: 'Alice',
      lastName: 'A',
      notes: 'SECRET-A',
      password: 'passA1234',
      phone: '111',
    },
  })) as Doc
  customerB = (await payload.create({
    collection: 'customers',
    data: { email: 'sa-b@example.com', firstName: 'Bob', lastName: 'B', password: 'passB1234' },
  })) as Doc

  const service = await payload.create({
    collection: 'services',
    data: { name: 'SA Cut', duration: 30, durationType: 'fixed' },
  })
  serviceId = service.id
  const resource = await payload.create({
    collection: 'resources',
    data: { name: 'SA Chair', quantity: 5, services: [serviceId] },
  })
  resourceId = resource.id

  reservationA = (await payload.create({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      customer: customerA.id,
      endTime: futureIso(7, 10),
      resource: resourceId,
      service: serviceId,
      startTime: futureIso(7, 9),
      status: 'pending',
    },
  })) as Doc
  guestReservation = (await payload.create({
    collection: 'reservations',
    context: { skipReservationHooks: true },
    data: {
      endTime: futureIso(7, 12),
      guest: { name: 'Walk In', email: 'walkin@example.com' },
      resource: resourceId,
      service: serviceId,
      startTime: futureIso(7, 11),
      status: 'pending',
    },
  })) as Doc
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('standalone Reservations access', () => {
  it('a customer lists only their own reservations — never another customer\'s or a guest\'s', async () => {
    const asB = await payload.find({ collection: 'reservations', overrideAccess: false, user: asCustomer(customerB) })
    expect(asB.docs.map((d) => String(d.id))).not.toContain(String(reservationA.id))
    expect(asB.docs.map((d) => String(d.id))).not.toContain(String(guestReservation.id))

    const asA = await payload.find({ collection: 'reservations', overrideAccess: false, user: asCustomer(customerA) })
    expect(asA.docs.map((d) => String(d.id))).toContain(String(reservationA.id))
    expect(asA.docs.map((d) => String(d.id))).not.toContain(String(guestReservation.id))
  })

  it('a customer cannot read another customer\'s reservation by id', async () => {
    await expect(
      payload.findByID({ id: reservationA.id, collection: 'reservations', overrideAccess: false, user: asCustomer(customerB) }),
    ).rejects.toThrow()
  })

  it('a customer cannot update another customer\'s reservation', async () => {
    await expect(
      payload.update({
        id: reservationA.id,
        collection: 'reservations',
        data: { notes: 'hacked' },
        overrideAccess: false,
        user: asCustomer(customerB),
      }),
    ).rejects.toThrow()
    const fresh = await payload.findByID({ id: reservationA.id, collection: 'reservations' })
    expect(fresh.notes).not.toBe('hacked')
  })

  it('a customer can update their own reservation, but cannot hand it to another customer', async () => {
    const updated = await payload.update({
      id: reservationA.id,
      collection: 'reservations',
      data: { customer: customerB.id, notes: 'mine' },
      overrideAccess: false,
      user: asCustomer(customerA),
    })
    expect(updated.notes).toBe('mine')
    const fresh = await payload.findByID({ id: reservationA.id, collection: 'reservations', depth: 0 })
    expect(String(fresh.customer)).toBe(String(customerA.id))
  })

  it('a customer cannot delete any reservation, their own included', async () => {
    await expect(
      payload.delete({ id: reservationA.id, collection: 'reservations', overrideAccess: false, user: asCustomer(customerB) }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ id: reservationA.id, collection: 'reservations', overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toThrow()
    const still = await payload.count({ collection: 'reservations', where: { id: { equals: reservationA.id } } })
    expect(still.totalDocs).toBe(1)
  })

  it('anonymous callers are refused', async () => {
    await expect(payload.find({ collection: 'reservations', overrideAccess: false })).rejects.toThrow(
      /Forbidden|not allowed/,
    )
  })

  it('staff (any other auth collection) keep full access', async () => {
    const all = await payload.find({ collection: 'reservations', overrideAccess: false, user: asStaff })
    expect(all.docs.map((d) => String(d.id))).toEqual(
      expect.arrayContaining([String(reservationA.id), String(guestReservation.id)]),
    )
    const updated = await payload.update({
      id: guestReservation.id,
      collection: 'reservations',
      data: { notes: 'staff note' },
      overrideAccess: false,
      user: asStaff,
    })
    expect(updated.notes).toBe('staff note')
  })

  it('a consumer access override still wins per operation', async () => {
    const { createReservationsCollection } = await import('../src/collections/Reservations.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const openRead = () => true
    const col = createReservationsCollection(
      resolveConfig({ access: { reservations: { read: openRead } } }),
    )
    expect(col.access?.read).toBe(openRead)
    expect(typeof col.access?.update).toBe('function')
    expect(typeof col.access?.delete).toBe('function')
    expect(col.access?.create).toBeUndefined()
  })

  it('userCollection mode is left on Payload\'s default (documented, warned at boot)', async () => {
    const { createReservationsCollection } = await import('../src/collections/Reservations.js')
    const { resolveConfig } = await import('../src/defaults.js')
    const col = createReservationsCollection(resolveConfig({ userCollection: 'users' }))
    expect(col.access).toEqual({})
  })
})

describe('standalone Customers access', () => {
  it('a customer sees only their own document — no other customer\'s email/phone/notes', async () => {
    const asB = await payload.find({ collection: 'customers', overrideAccess: false, user: asCustomer(customerB) })
    expect(asB.docs.map((d) => String(d.id))).toEqual([String(customerB.id)])
    await expect(
      payload.findByID({ id: customerA.id, collection: 'customers', overrideAccess: false, user: asCustomer(customerB) }),
    ).rejects.toThrow()
  })

  it('a customer cannot change another customer\'s password (account takeover)', async () => {
    await expect(
      payload.update({
        id: customerA.id,
        collection: 'customers',
        data: { password: 'owned9999' },
        overrideAccess: false,
        user: asCustomer(customerB),
      }),
    ).rejects.toThrow()
    await expect(
      payload.login({ collection: 'customers', data: { email: 'sa-a@example.com', password: 'owned9999' } }),
    ).rejects.toThrow()
    const stillA = await payload.login({ collection: 'customers', data: { email: 'sa-a@example.com', password: 'passA1234' } })
    expect(stillA.token).toBeTruthy()
  })

  it('a customer can update their own profile', async () => {
    const updated = await payload.update({
      id: customerB.id,
      collection: 'customers',
      data: { phone: '222' },
      overrideAccess: false,
      user: asCustomer(customerB),
    })
    expect(updated.phone).toBe('222')
  })

  it('a customer cannot delete any customer', async () => {
    await expect(
      payload.delete({ id: customerA.id, collection: 'customers', overrideAccess: false, user: asCustomer(customerB) }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ id: customerB.id, collection: 'customers', overrideAccess: false, user: asCustomer(customerB) }),
    ).rejects.toThrow()
  })

  it('staff still list every customer', async () => {
    const all = await payload.find({ collection: 'customers', overrideAccess: false, user: asStaff })
    expect(all.docs.map((d) => String(d.id))).toEqual(
      expect.arrayContaining([String(customerA.id), String(customerB.id)]),
    )
  })

  it('the bookings join, read by its owner, only carries their own reservations', async () => {
    const me = await payload.findByID({
      id: customerA.id,
      collection: 'customers',
      overrideAccess: false,
      user: asCustomer(customerA),
    })
    const bookings = (me as { bookings?: { docs?: Array<{ id: unknown } | unknown> } }).bookings?.docs ?? []
    const ids = bookings.map((b) => String(typeof b === 'object' && b !== null && 'id' in b ? b.id : b))
    expect(ids).toContain(String(reservationA.id))
    expect(ids).not.toContain(String(guestReservation.id))
  })
})

describe('guestCount must be a whole number', () => {
  it('rejects a fractional guestCount on the collection, like /reserve/hold already did', async () => {
    await expect(
      payload.create({
        collection: 'reservations',
        data: { customer: customerA.id, guestCount: 1.5, resource: resourceId, service: serviceId, startTime: futureIso(9) },
      }),
    ).rejects.toMatchObject({ data: { errors: [{ message: 'guestCount must be a whole number', path: 'guestCount' }] } })
  })

  it('rejects a fractional guestCount on an items[] entry', async () => {
    await expect(
      payload.create({
        collection: 'reservations',
        data: {
          customer: customerA.id,
          items: [{ guestCount: 2.5, resource: resourceId, service: serviceId, startTime: futureIso(10) }],
          resource: resourceId,
          service: serviceId,
          startTime: futureIso(10),
        },
      }),
    ).rejects.toMatchObject({ data: { errors: [{ message: 'guestCount must be a whole number' }] } })
  })

  it('still accepts an integer', async () => {
    const r = await payload.create({
      collection: 'reservations',
      data: { customer: customerA.id, guestCount: 2, resource: resourceId, service: serviceId, startTime: futureIso(11) },
    })
    expect(r.guestCount).toBe(2)
  })
})

import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createCancelBookingEndpoint } from '../src/endpoints/cancelBooking.js'
import { createCheckAvailabilityEndpoint } from '../src/endpoints/checkAvailability.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { buildAvailabilityReasonPayload } from './helpers/availabilityReasonPayload.js'

/** Payload wraps a hook's message; the real text sits at data.errors[0].message. */
const validation = (re: RegExp) => ({ data: { errors: [{ message: expect.stringMatching(re) }] } })

/**
 * Regression coverage for the 4.1.2 audit fixes, standalone mode, access checks
 * on where a customer is the actor. Each describe names the finding it pins.
 */

let payload: Payload
let stop: () => Promise<void>

type Doc = { id: number | string } & Record<string, unknown>
const asCustomer = (c: Doc) => ({ ...c, collection: 'customers' }) as never
const asStaff = { id: 'staff-1', collection: 'users' } as never
const col = (slug: string) => slug as 'users'

let customerA: Doc
let customerB: Doc
let service30: Doc
let service60: Doc
let resource: Doc
let resource2: Doc

/** Next Monday at `hour`:00 UTC, at least `weeksAhead` weeks out. */
const nextMonday = (weeksAhead: number, hour: number, minute = 0) => {
  const d = new Date()
  d.setUTCHours(hour, minute, 0, 0)
  const day = d.getUTCDay()
  const delta = ((8 - day) % 7 || 7) + 7 * (weeksAhead - 1)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString()
}
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

beforeAll(async () => {
  const built = await buildAvailabilityReasonPayload('auditfixesmemory')
  payload = built.payload
  stop = built.stop

  customerA = (await payload.create({
    collection: col('customers'),
    data: { email: 'af-a@example.com', firstName: 'A', lastName: 'A', notes: 'STAFF-ONLY', password: 'passA1234' },
  })) as Doc
  customerB = (await payload.create({
    collection: col('customers'),
    data: { email: 'af-b@example.com', firstName: 'B', lastName: 'B', password: 'passB1234' },
  })) as Doc
  service30 = (await payload.create({
    collection: col('services'),
    data: { name: 'AF 30', duration: 30, durationType: 'fixed' },
  })) as Doc
  service60 = (await payload.create({
    collection: col('services'),
    data: { name: 'AF 60', duration: 60, durationType: 'fixed' },
  })) as Doc
  resource = (await payload.create({
    collection: col('resources'),
    data: { name: 'AF Chair', quantity: 10, services: [service30.id, service60.id] },
  })) as Doc
  resource2 = (await payload.create({
    collection: col('resources'),
    data: { name: 'AF Room', quantity: 10, services: [service30.id, service60.id] },
  })) as Doc
  // Mon–Fri 09:00–17:00 (UTC business zone) on the main resource only.
  await payload.create({
    collection: col('schedules'),
    data: {
      name: 'AF weekdays',
      recurringSlots: ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => ({
        day,
        endTime: '17:00',
        startTime: '09:00',
      })),
      resource: resource.id,
      scheduleType: 'recurring',
    },
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

const createFor = (customer: Doc, startTime: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: col('reservations'),
    context: { skipReservationHooks: true },
    data: {
      customer: customer.id,
      endTime: new Date(Date.parse(startTime) + 1_800_000).toISOString(),
      resource: resource.id,
      service: service30.id,
      startTime,
      status: 'pending',
      ...extra,
    },
  }) as Promise<Doc>

describe('catalog collections are staff-only for writes in standalone mode', () => {
  it('a customer cannot create, update or delete a service, resource or schedule', async () => {
    for (const slug of ['services', 'resources', 'schedules']) {
      await expect(
        payload.create({ collection: col(slug), data: { name: 'x' }, overrideAccess: false, user: asCustomer(customerA) }),
      ).rejects.toThrow()
    }
    await expect(
      payload.update({ id: resource.id, collection: col('resources'), data: { active: false }, overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toThrow()
    await expect(
      payload.update({ id: service30.id, collection: col('services'), data: { bufferTimeBefore: 1439 }, overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toThrow()
    await expect(
      payload.delete({ id: resource.id, collection: col('resources'), overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toThrow()
    const fresh = await payload.findByID({ id: resource.id, collection: col('resources') })
    expect(fresh.active).not.toBe(false)
  })

  it('a customer can still read them, and staff can still write them', async () => {
    const list = await payload.find({ collection: col('services'), overrideAccess: false, user: asCustomer(customerA) })
    expect(list.totalDocs).toBeGreaterThan(0)
    const updated = await payload.update({
      id: service30.id, collection: col('services'), data: { description: 'staff edit' }, overrideAccess: false, user: asStaff,
    })
    expect(updated.description).toBe('staff edit')
  })
})

describe('a customer cannot change status except to cancel', () => {
  it('rejects PATCH status: confirmed on their own row', async () => {
    const r = await createFor(customerA, nextMonday(3, 10))
    await expect(
      payload.update({ id: r.id, collection: col('reservations'), data: { status: 'confirmed' }, overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toMatchObject({ data: { errors: [{ message: 'Only staff can change a reservation status' }] } })
    const fresh = await payload.findByID({ id: r.id, collection: col('reservations') })
    expect(fresh.status).toBe('pending')
  })

  it('still lets the customer cancel with enough notice, and staff confirm', async () => {
    const r = await createFor(customerA, nextMonday(3, 11))
    const cancelled = await payload.update({
      id: r.id, collection: col('reservations'), data: { status: 'cancelled' }, overrideAccess: false, user: asCustomer(customerA),
    })
    expect(cancelled.status).toBe('cancelled')
    const r2 = await createFor(customerA, nextMonday(3, 12))
    const confirmed = await payload.update({ id: r2.id, collection: col('reservations'), data: { status: 'confirmed' }, user: asStaff })
    expect(confirmed.status).toBe('confirmed')
  })
})

describe('cancellation notice period cannot be dodged', () => {
  it('a back-dated startTime sent with the cancel does not help', async () => {
    const r = await createFor(customerA, hoursFromNow(2))
    await expect(
      payload.update({
        id: r.id,
        collection: col('reservations'),
        data: { startTime: hoursFromNow(-30), status: 'cancelled' },
        overrideAccess: false,
        user: asCustomer(customerA),
      }),
      // Refused twice over: the notice period reads the STORED start, and a
      // customer may not move a booking into the past at all.
    ).rejects.toMatchObject(validation(/notice|in the past/))
    const fresh = await payload.findByID({ id: r.id, collection: col('reservations') })
    expect(fresh.status).toBe('pending')
  })

  it('a customer cannot reschedule inside the window either', async () => {
    const r = await createFor(customerA, hoursFromNow(2))
    await expect(
      payload.update({
        id: r.id,
        collection: col('reservations'),
        data: { startTime: nextMonday(4, 10) },
        overrideAccess: false,
        user: asCustomer(customerA),
      }),
    ).rejects.toMatchObject(validation(/notice/))
  })

  it('a customer cannot cancel a booking that already started', async () => {
    const r = await createFor(customerA, hoursFromNow(-1))
    await expect(
      payload.update({ id: r.id, collection: col('reservations'), data: { status: 'cancelled' }, overrideAccess: false, user: asCustomer(customerA) }),
    ).rejects.toMatchObject(validation(/notice/))
  })

  it('staff are exempt, and userless Local API calls keep the legacy rule', async () => {
    const r = await createFor(customerA, hoursFromNow(2))
    const byStaff = await payload.update({ id: r.id, collection: col('reservations'), data: { status: 'cancelled' }, user: asStaff })
    expect(byStaff.status).toBe('cancelled')
    const started = await createFor(customerA, hoursFromNow(-1))
    const byServer = await payload.update({ id: started.id, collection: col('reservations'), data: { status: 'cancelled' } })
    expect(byServer.status).toBe('cancelled')
    const soon = await createFor(customerA, hoursFromNow(2))
    await expect(
      payload.update({ id: soon.id, collection: col('reservations'), data: { status: 'cancelled' } }),
    ).rejects.toMatchObject(validation(/notice/))
  })
})

describe('flexible windows are bounded', () => {
  let flexible: Doc
  beforeAll(async () => {
    flexible = (await payload.create({
      collection: col('services'),
      data: { name: 'AF Flex', duration: 30, durationType: 'flexible' },
    })) as Doc
    await payload.update({ id: resource2.id, collection: col('resources'), data: { services: [service30.id, service60.id, flexible.id] } })
  })

  it('rejects an endTime beyond maxFlexibleDuration (default 24h)', async () => {
    const start = nextMonday(5, 9)
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: customerA.id, endTime: '2099-01-01T00:00:00.000Z', resource: resource2.id, service: flexible.id, startTime: start },
      }),
    ).rejects.toMatchObject(validation(/cannot exceed 1440 minutes/))
  })

  it('rejects an endTime shorter than the service minimum', async () => {
    const start = nextMonday(5, 9)
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: customerA.id, endTime: new Date(Date.parse(start) + 600_000).toISOString(), resource: resource2.id, service: flexible.id, startTime: start },
      }),
    ).rejects.toMatchObject(validation(/at least 30 minutes/))
  })

  it('accepts a window between the two', async () => {
    const start = nextMonday(5, 9)
    const r = await payload.create({
      collection: col('reservations'),
      data: { customer: customerA.id, endTime: new Date(Date.parse(start) + 5_400_000).toISOString(), resource: resource2.id, service: flexible.id, startTime: start },
    })
    expect(r.id).toBeTruthy()
  })
})

describe('booking responses do not leak field-protected data', () => {
  it('/reserve/book returns relationship ids, not the customer document with staff notes', async () => {
    const ep = createBookingEndpoint(resolveConfig({}))
    const req = {
      json: () => Promise.resolve({ resource: resource.id, service: service30.id, startTime: nextMonday(6, 10) }),
      payload,
      t: (k: string) => k,
      user: asCustomer(customerA),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(201)
    const body = (await resp.json()) as Record<string, unknown>
    expect(typeof body.customer === 'object' && body.customer !== null).toBe(false)
    expect(String(body.customer)).toBe(String(customerA.id))
    expect(JSON.stringify(body)).not.toContain('STAFF-ONLY')
    expect(body.cancellationToken).toBeUndefined()
  })

  it('/reserve/cancel returns relationship ids too', async () => {
    const r = await createFor(customerA, nextMonday(6, 12))
    const ep = createCancelBookingEndpoint(resolveConfig({}))
    const req = { json: () => Promise.resolve({ reservationId: r.id }), payload, t: (k: string) => k, user: asCustomer(customerA) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as Record<string, unknown>
    expect(JSON.stringify(body)).not.toContain('STAFF-ONLY')
    expect(String(body.customer)).toBe(String(customerA.id))
  })
})

describe('public bookings respect the past and the schedule', () => {
  it('a customer cannot book in the past', async () => {
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: customerA.id, resource: resource.id, service: service30.id, startTime: hoursFromNow(-48) },
        overrideAccess: false,
        user: asCustomer(customerA),
      }),
    ).rejects.toMatchObject(validation(/in the past/))
  })

  it('a customer cannot book outside the resource schedule (Sunday), staff can', async () => {
    const monday = new Date(nextMonday(7, 10))
    const sunday = new Date(monday.getTime() - 86_400_000).toISOString()
    await expect(
      payload.create({
        collection: col('reservations'),
        data: { customer: customerA.id, resource: resource.id, service: service30.id, startTime: sunday },
        overrideAccess: false,
        user: asCustomer(customerA),
      }),
    ).rejects.toMatchObject(validation(/outside the resource's schedule/))
    const staffBooking = await payload.create({
      collection: col('reservations'),
      data: { customer: customerA.id, resource: resource.id, service: service30.id, startTime: sunday },
      user: asStaff,
    })
    expect(staffBooking.id).toBeTruthy()
  })

  it('an anonymous /reserve/book outside the schedule is refused; inside it is accepted', async () => {
    const ep = createBookingEndpoint(resolveConfig({ allowGuestBooking: true }))
    await payload.update({ id: service30.id, collection: col('services'), data: { allowGuestBooking: 'enabled' } })
    const monday = new Date(nextMonday(8, 10))
    const sunday = new Date(monday.getTime() - 86_400_000).toISOString()
    const mk = (startTime: string) => ({
      json: () => Promise.resolve({ guest: { name: 'G', email: 'g@example.com' }, resource: resource.id, service: service30.id, startTime }),
      payload,
      t: (k: string) => k,
    })
    // A hook rejection propagates out of the handler; Payload's router turns
    // it into the 400 a real client sees.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ep.handler(mk(sunday) as any)).rejects.toMatchObject(validation(/outside the resource's schedule/))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await ep.handler(mk(monday.toISOString()) as any)
    expect(ok.status).toBe(201)
  })

  it('a resource with no schedule at all is unconstrained', async () => {
    const r = await payload.create({
      collection: col('reservations'),
      data: { customer: customerA.id, resource: resource2.id, service: service30.id, startTime: nextMonday(9, 3) },
      overrideAccess: false,
      user: asCustomer(customerA),
    })
    expect(r.id).toBeTruthy()
  })
})

describe('guest gating covers items[] services', () => {
  it('an anonymous guest cannot attach a line item on a guest-disabled service', async () => {
    const gated = await payload.create({
      collection: col('services'),
      data: { name: 'AF Gated', allowGuestBooking: 'disabled', duration: 30 },
    })
    const ep = createBookingEndpoint(resolveConfig({ allowGuestBooking: true }))
    const start = nextMonday(10, 10)
    const req = {
      json: () =>
        Promise.resolve({
          guest: { name: 'G', email: 'g2@example.com' },
          items: [{ resource: resource2.id, service: gated.id, startTime: start }],
          resource: resource.id,
          service: service30.id,
          startTime: start,
        }),
      payload,
      t: (k: string) => k,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ep.handler(req as any)).rejects.toMatchObject(validation(/not allowed/))
  })
})

describe('required resources cannot be dodged', () => {
  let pool: Doc
  let needsPool: Doc
  beforeAll(async () => {
    pool = (await payload.create({ collection: col('resources'), data: { name: 'AF Pool', quantity: 1 } })) as Doc
    needsPool = (await payload.create({
      collection: col('services'),
      data: { name: 'AF Needs Pool', duration: 30, requiredResources: [pool.id] },
    })) as Doc
    await payload.update({ id: resource2.id, collection: col('resources'), data: { services: [service30.id, service60.id, needsPool.id] } })
  })

  it('listing the pool at an unrelated time still expands it at the real time', async () => {
    const start = nextMonday(11, 10)
    const r = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerA.id,
        items: [{ resource: pool.id, startTime: '2031-01-01T03:00:00.000Z' }],
        resource: resource2.id,
        service: needsPool.id,
        startTime: start,
      },
      depth: 0,
    })
    const items = r.items as Array<{ resource: unknown; startTime: string }>
    const atRealTime = items.filter((i) => String(i.resource) === String(pool.id) && Date.parse(i.startTime) === Date.parse(start))
    expect(atRealTime).toHaveLength(1)
  })

  it('changing a booking onto a service with a pool expands it on update', async () => {
    const start = nextMonday(12, 10)
    const r = await payload.create({
      collection: col('reservations'),
      data: { customer: customerA.id, resource: resource2.id, service: service30.id, startTime: start },
      depth: 0,
    })
    expect(r.items ?? []).toHaveLength(0)
    const updated = await payload.update({ id: r.id, collection: col('reservations'), data: { service: needsPool.id }, depth: 0 })
    const items = (updated.items ?? []) as Array<{ resource: unknown }>
    expect(items.some((i) => String(i.resource) === String(pool.id))).toBe(true)
  })
})

describe('a single items[] entry keeps its own service duration', () => {
  it('a 60-minute item on a second resource occupies 60 minutes, and the top-level end covers it', async () => {
    const start = nextMonday(13, 10)
    const r = await payload.create({
      collection: col('reservations'),
      data: {
        customer: customerA.id,
        items: [{ resource: resource2.id, service: service60.id, startTime: start }],
        resource: resource.id,
        service: service30.id,
        startTime: start,
      },
      depth: 0,
    })
    const item = (r.items as Array<{ endTime: string }>)[0]
    expect(Date.parse(item.endTime) - Date.parse(start)).toBe(3_600_000)
    expect(Date.parse(r.endTime as string) - Date.parse(start)).toBe(3_600_000)
  })
})

describe('a customer cannot orphan or hybridise their reservation', () => {
  it('customer: null is pinned back to themselves', async () => {
    const r = await createFor(customerA, nextMonday(14, 10))
    const updated = await payload.update({
      id: r.id, collection: col('reservations'), data: { customer: null }, depth: 0, overrideAccess: false, user: asCustomer(customerA),
    })
    expect(String(updated.customer)).toBe(String(customerA.id))
  })

  it('adding guest data to an attributed booking is rejected', async () => {
    const r = await createFor(customerA, nextMonday(14, 11))
    await expect(
      payload.update({
        id: r.id, collection: col('reservations'), data: { guest: { name: 'x', email: 'x@example.com' } }, overrideAccess: false, user: asCustomer(customerA),
      }),
    ).rejects.toThrow()
  })
})

describe('endpoint input hardening', () => {
  it('malformed JSON is a 400, not a 500, on book and cancel', async () => {
    const bad = { json: () => Promise.reject(new SyntaxError('Unexpected token')), payload, t: (k: string) => k }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await createBookingEndpoint(resolveConfig({})).handler(bad as any)).status).toBe(400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await createCancelBookingEndpoint(resolveConfig({})).handler(bad as any)).status).toBe(400)
    const nul = { json: () => Promise.resolve(null), payload, t: (k: string) => k }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await createBookingEndpoint(resolveConfig({})).handler(nul as any)).status).toBe(400)
  })

  it('cancelling an unknown reservation id is a 404', async () => {
    const req = { json: () => Promise.resolve({ reservationId: '000000000000000000000000' }), payload, t: (k: string) => k, user: asStaff }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await createCancelBookingEndpoint(resolveConfig({})).handler(req as any)).status).toBe(404)
  })

  it('resources= is capped and unknown ids are a 404', async () => {
    const ep = createCheckAvailabilityEndpoint(resolveConfig({}))
    const mk = (qs: string) => ({ payload, url: `http://localhost/api/reserve/availability?${qs}` })
    const many = Array.from({ length: 21 }, (_, i) => `id${i}`).join(',')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await ep.handler(mk(`date=2033-04-04&service=${service30.id}&resource=${resource.id}&resources=${many}`) as any)).status).toBe(400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await ep.handler(mk(`date=2033-04-04&service=${service30.id}&resource=${resource.id}&resources=000000000000000000000000`) as any)).status).toBe(404)
  })
})

describe('customerB is untouched by any of the above', () => {
  it('still sees none of A', async () => {
    const asB = await payload.find({ collection: col('reservations'), overrideAccess: false, user: asCustomer(customerB) })
    expect(asB.totalDocs).toBe(0)
  })
})

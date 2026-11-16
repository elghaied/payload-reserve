// Regression tests for the 4.4.2 audit: GHSA-qpqp-37cp-f422, GHSA-j932-r8vr-hm68,
// GHSA-fv46-ch5v-5wcm, GHSA-p6jg-9v93-cqrw, GHSA-54qr-6mpg-5f58 and issues #9–#12.
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createCancelBookingEndpoint } from '../src/endpoints/cancelBooking.js'
import { createBookingEndpoint } from '../src/endpoints/createBooking.js'
import { createHoldSlotEndpoint } from '../src/endpoints/holdSlot.js'
import { createReleaseSlotEndpoint } from '../src/endpoints/releaseSlot.js'
import { expandRequiredResources } from '../src/hooks/reservations/expandRequiredResources.js'
import { getAvailableSlots, peakUnits } from '../src/services/AvailabilityService.js'
import { makeOwnerModeCreate, makeStandaloneCustomerAccess } from '../src/utilities/ownerAccess.js'

let payload: Payload
afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'
const resolved = resolveConfig({
  allowGuestBooking: true,
  cancellationNoticePeriod: 24,
  slotHolds: { enabled: true, ttlMinutes: 10 },
})
const H = 3_600_000
const guest = { name: 'Audit Guest', email: 'audit-guest@example.com' }
const staff = { id: 'staff-1', collection: 'users' }

/** Calls a handler the way Payload would; a thrown error becomes its status. */
const call = async (endpoint: { handler: unknown }, body: unknown, user: unknown = null) => {
  try {
    const res = await (endpoint.handler as (r: never) => Promise<Response>)({
      json: () => Promise.resolve(body),
      payload,
      user,
    } as never)
    return { body: (await res.json().catch(() => null)) as Record<string, unknown>, status: res.status }
  } catch (err) {
    const e = err as { data?: { errors?: Array<{ message: string }> }; status?: number }
    return { body: { error: e.data?.errors?.[0]?.message }, status: e.status ?? 500 }
  }
}

const svc = (name: string, extra: Record<string, unknown> = {}) =>
  payload.create({
    collection: col('services'),
    data: { name, active: true, bufferTimeAfter: 0, bufferTimeBefore: 0, duration: 60, ...extra } as never,
  })
const res = (name: string, extra: Record<string, unknown> = {}) =>
  payload.create({ collection: col('resources'), data: { name, active: true, ...extra } as never })
const customerOf = (tag: string) =>
  payload.create({
    collection: col('customers'),
    data: { email: `audit-${tag}-${Date.now()}@example.com`, firstName: 'A', lastName: tag, password: 'test1234' } as never,
  })
const book = (data: Record<string, unknown>) =>
  payload.create({ collection: col('reservations'), data: data as never }) as unknown as Promise<
    Record<string, unknown>
  >

describe('guest cancellation token (GHSA-qpqp-37cp-f422)', () => {
  test('cannot cancel once the booking has started', async () => {
    const s = await svc('gc svc')
    const r = await res('gc res')
    const b = await book({
      guest,
      resource: r.id,
      service: s.id,
      startTime: new Date(Date.now() - H / 2).toISOString(),
    })
    const out = await call(createCancelBookingEndpoint(resolved), {
      reservationId: b.id,
      token: b.cancellationToken,
    })
    expect(out.status).toBe(400)
    const after = await payload.findByID({ id: b.id as string, collection: col('reservations') })
    expect((after as unknown as { status: string }).status).toBe('pending')
  })

  test('still cancels with enough notice, also for a signed-in token holder', async () => {
    const s = await svc('gc svc 2')
    const r = await res('gc res 2', { quantity: 2 })
    const start = new Date(Date.now() + 72 * H).toISOString()
    const anon = await book({ guest, resource: r.id, service: s.id, startTime: start })
    const signedIn = await book({ guest, resource: r.id, service: s.id, startTime: start })
    const bystander = await customerOf('bystander')

    expect(
      (await call(createCancelBookingEndpoint(resolved), {
        reservationId: anon.id,
        token: anon.cancellationToken,
      })).status,
    ).toBe(200)
    const viaToken = await call(
      createCancelBookingEndpoint(resolved),
      { reservationId: signedIn.id, token: signedIn.cancellationToken },
      { id: bystander.id, collection: 'customers' },
    )
    expect(viaToken.status).toBe(200)
    expect(viaToken.body.status).toBe('cancelled')
    expect(viaToken.body.customer ?? null).toBeNull()
    // Wrong token, signed in or not: refused.
    const other = await book({ guest, resource: r.id, service: s.id, startTime: new Date(Date.now() + 96 * H).toISOString() })
    expect(
      (await call(
        createCancelBookingEndpoint(resolved),
        { reservationId: other.id, token: 'nope' },
        { id: bystander.id, collection: 'customers' },
      )).status,
    ).toBe(403)
  })
})

describe('/reserve/cancel ownership and input (GHSA-54qr-6mpg-5f58, #12)', () => {
  test('a staff user whose id equals the customer id is not the owner', async () => {
    let seen: Record<string, unknown> = {}
    const stub = {
      findByID: () => Promise.resolve({ id: 1, customer: 5 }),
      update: (args: Record<string, unknown>) => {
        seen = args
        return Promise.resolve({ id: 1 })
      },
    }
    const handler = createCancelBookingEndpoint(resolved).handler as (r: never) => Promise<Response>
    const out = await handler({
      json: () => Promise.resolve({ reservationId: 1 }),
      payload: stub,
      user: { id: 5, collection: 'users' },
    } as never)
    expect(out.status).toBe(200)
    // Delegated: owner-mode and tenant access rules apply to this write.
    expect(seen.overrideAccess).toBe(false)
  })

  test('non-string input is a 400', async () => {
    expect((await call(createCancelBookingEndpoint(resolved), { reservationId: { $ne: null } })).status).toBe(400)
    expect((await call(createCancelBookingEndpoint(resolved), { reservationId: 'x', token: {} })).status).toBe(400)
    expect((await call(createReleaseSlotEndpoint(resolved), { token: { $ne: null } })).status).toBe(400)
  })
})

describe('public items[] limits (GHSA-j932-r8vr-hm68)', () => {
  test('items far apart cannot block an unlisted top-level resource', async () => {
    const s = await svc('span svc')
    const r1 = await res('span primary')
    const r2 = await res('span other', { quantity: 5 })
    const t = Date.now() + 50 * 24 * H
    const body = {
      guest,
      items: [
        { resource: r2.id, startTime: new Date(t).toISOString() },
        { resource: r2.id, startTime: new Date(t + 30 * 24 * H).toISOString() },
      ],
      resource: r1.id,
      service: s.id,
      startTime: new Date(t).toISOString(),
    }
    const out = await call(createBookingEndpoint(resolved), body)
    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/span more than/)
    // Staff are not limited.
    expect((await call(createBookingEndpoint(resolved), body, staff)).status).toBe(201)
  })

  test('items[] is capped for public actors only', async () => {
    const s = await svc('cap svc')
    const r = await res('cap res')
    const t = Date.now() + 200 * 24 * H
    const items = Array.from({ length: 11 }, (_, i) => ({
      resource: r.id,
      startTime: new Date(t + i * 2 * H).toISOString(),
    }))
    const body = { guest, items, resource: r.id, service: s.id, startTime: new Date(t).toISOString() }
    const out = await call(createBookingEndpoint(resolved), body)
    expect(out.status).toBe(400)
    expect(out.body.error).toMatch(/at most 10 items/)
    expect((await call(createBookingEndpoint(resolved), body, staff)).status).toBe(201)
  })
})

describe('service/resource pairing (GHSA-fv46-ch5v-5wcm)', () => {
  test('public bookings and holds must use a service the resource offers', async () => {
    const offered = await svc('pair offered')
    const other = await svc('pair other', { duration: 5 })
    const r = await res('pair res', { quantity: 5, services: [offered.id] })
    const open = await res('pair open (no services listed)')
    const at = (d: number) => new Date(Date.now() + d * 24 * H).toISOString()

    const bad = await call(createBookingEndpoint(resolved), {
      guest,
      resource: r.id,
      service: other.id,
      startTime: at(120),
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/does not offer/)

    const ok = { guest, resource: r.id, service: offered.id, startTime: at(121) }
    expect((await call(createBookingEndpoint(resolved), ok)).status).toBe(201)
    // Empty list is unconstrained; staff are exempt.
    expect(
      (await call(createBookingEndpoint(resolved), { guest, resource: open.id, service: other.id, startTime: at(122) })).status,
    ).toBe(201)
    expect(
      (await call(createBookingEndpoint(resolved), { guest, resource: r.id, service: other.id, startTime: at(123) }, staff)).status,
    ).toBe(201)

    const hold = await call(createHoldSlotEndpoint(resolved), {
      resource: r.id,
      service: other.id,
      startTime: at(124),
    })
    expect(hold.status).toBe(409)
    expect(hold.body.error).toBe('service_not_offered')
  })

  test('a required pool does not have to list the service', async () => {
    const pool = await res('pair pool', { quantity: 3 })
    const unrelated = await svc('pair unrelated')
    // The pool lists a different service, so only the exemption lets it through.
    await payload.update({ id: pool.id, collection: col('resources'), data: { services: [unrelated.id] } as never })
    const s = await svc('pair with pool', { requiredResources: [pool.id] })
    const r = await res('pair primary', { services: [s.id] })
    const out = await call(createBookingEndpoint(resolved), {
      guest,
      resource: r.id,
      service: s.id,
      startTime: new Date(Date.now() + 130 * 24 * H).toISOString(),
    })
    expect(out.status).toBe(201)
  })
})

describe('create access (GHSA-p6jg-9v93-cqrw)', () => {
  const customer = { req: { user: { id: 1, collection: 'customers' } } } as never
  const owner = { req: { user: { id: 1, collection: 'users' } } } as never

  test('owner mode: customers cannot create when owners live elsewhere', () => {
    const separate = resolveConfig({ resourceOwnerMode: { ownerCollection: 'users' } })
    expect(makeOwnerModeCreate(separate)(customer)).toBe(false)
    expect(makeOwnerModeCreate(separate)(owner)).toBe(true)
    // Owners ARE the customers collection: indistinguishable, stays open.
    expect(makeOwnerModeCreate(resolveConfig({ resourceOwnerMode: {} }))(customer)).toBe(true)
    expect(makeOwnerModeCreate(separate)({ req: { user: null } } as never)).toBe(false)
  })

  test('standalone: a customer cannot create customer accounts', () => {
    const { create } = makeStandaloneCustomerAccess(resolved)
    expect(create!(customer)).toBe(false)
    expect(create!(owner)).toBe(true)
  })
})

describe('capacity is peak concurrency (#9)', () => {
  const d = (h: number) => new Date(Date.UTC(2030, 0, 1, h))
  const occ = (from: number, to: number, units = 1) => ({ blockedEnd: d(to), blockedStart: d(from), units })

  test('peakUnits', () => {
    expect(peakUnits([occ(10, 11), occ(11, 12)], d(10), d(12))).toBe(1)
    expect(peakUnits([occ(10, 12), occ(11, 13)], d(10), d(12))).toBe(2)
    expect(peakUnits([occ(8, 9), occ(10, 11, 3)], d(10), d(12))).toBe(3)
    expect(peakUnits([], d(10), d(12))).toBe(0)
  })

  test('a window spanning two back-to-back bookings fits a quantity-2 resource', async () => {
    const s = await svc('peak fixed')
    const flex = await svc('peak flex', { durationType: 'flexible' })
    const r = await res('peak res', { quantity: 2 })
    const t = Date.now() + 100 * 24 * H
    const at = (h: number) => new Date(t + h * H).toISOString()
    await book({ guest, resource: r.id, service: s.id, startTime: at(0) })
    await book({ guest, resource: r.id, service: s.id, startTime: at(1) })
    await book({ endTime: at(2), guest, resource: r.id, service: flex.id, startTime: at(0) })
    // Now 2 of 2 are in use for the whole window: a fourth must not fit.
    await expect(
      book({ endTime: at(2), guest, resource: r.id, service: flex.id, startTime: at(0) }),
    ).rejects.toThrow()
  })
})

describe('slots load occupancy once per resource (#11)', () => {
  test('one reservation query for a whole day of candidates', async () => {
    const s = await svc('slots svc')
    const r = await res('slots res')
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'slots sched',
        active: true,
        recurringSlots: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({
          day,
          endTime: '17:00',
          startTime: '09:00',
        })),
        resource: r.id,
        scheduleType: 'recurring',
      } as never,
    })
    await book({ guest, resource: r.id, service: s.id, startTime: '2031-03-03T10:00:00.000Z' })

    const find = vi.spyOn(payload, 'find')
    const { slots } = await getAvailableSlots({
      blockingStatuses: resolved.statusMachine.blockingStatuses,
      date: '2031-03-03',
      payload,
      req: { payload } as never,
      reservationSlug: 'reservations',
      resourceId: r.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: s.id,
      serviceSlug: 'services',
    })
    const reservationQueries = find.mock.calls.filter(
      ([args]) => (args as { collection: string }).collection === 'reservations',
    ).length
    find.mockRestore()

    expect(reservationQueries).toBe(1)
    // 09:00–17:00 in 15-minute steps is 29 one-hour candidates; 10:00–11:00 is
    // taken, which removes the 7 starts from 09:15 to 10:45.
    expect(slots).toHaveLength(22)
    expect(slots.some((x) => x.start.toISOString() === '2031-03-03T10:00:00.000Z')).toBe(false)
  })
})

describe('fail closed (#10)', () => {
  test('expandRequiredResources rethrows a failed service read', async () => {
    const boom = new Error('db down')
    const hook = expandRequiredResources(resolved)
    await expect(
      hook({
        context: {},
        data: { service: 's1', startTime: new Date().toISOString() },
        operation: 'create',
        req: { payload: { findByID: () => Promise.reject(boom) } },
      } as never),
    ).rejects.toBe(boom)
  })
})

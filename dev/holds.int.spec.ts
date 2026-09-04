/**
 * Slot-hold harness.
 *
 * A hold is only worth having if it actually blocks other bookers, releases
 * cleanly, stops blocking once expired, and cannot be taken twice for the same
 * slot. Each of those is a separate test here, and the concurrency one is the
 * reason holds had to wait for the booking lock to land first.
 */
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { getAvailableSlots } from '../src/services/AvailabilityService.js'
import { releaseHold, takeHold } from '../src/services/HoldService.js'
import { retryOnWriteConflict } from '../src/utilities/retryOnWriteConflict.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'

/**
 * Must mirror the dev app's plugin options — notably `defaultBufferTime`, or a
 * hold would reserve a narrower window than the booking it protects.
 */
const resolved = resolveConfig({
  defaultBufferTime: 10,
  slotHolds: { enabled: true, ttlMinutes: 10 },
})

async function seed(tag: string, quantity = 1) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Hold Service ${tag}`, active: true, duration: 60 },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Hold Resource ${tag}`, active: true, quantity, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `hold-${tag}@example.com`,
      firstName: 'Hold',
      lastName: tag,
      password: 'test1234',
    },
  })
  return { customer, resource, service }
}

const reqFor = () => ({ payload, user: null }) as unknown as Parameters<typeof takeHold>[0]['req']

function bookingData(
  ids: { customer: number | string; resource: number | string; service: number | string },
  startTime: string,
) {
  return {
    customer: ids.customer,
    resource: ids.resource,
    service: ids.service,
    startTime,
    status: 'pending',
  }
}

describe('Slot holds', () => {
  test('an active hold blocks another customer from booking the slot', async () => {
    const { customer, resource, service } = await seed('blocks')
    const startTime = '2027-01-04T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    expect(held.ok).toBe(true)

    await expect(
      payload.create({
        collection: col('reservations'),
        data: bookingData(
          { customer: customer.id, resource: resource.id, service: service.id },
          startTime,
        ),
      }),
    ).rejects.toThrow()
  })

  test('the holder converts their own hold into a booking', async () => {
    const { customer, resource, service } = await seed('convert')
    const startTime = '2027-01-05T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    // Same slot, but presenting the hold's token — the hold must not block the
    // booking it exists to protect.
    const booking = await payload.create({
      collection: col('reservations'),
      context: { holdToken: held.hold.token },
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })

    expect(booking.id).toBeDefined()
  })

  test('releasing a hold frees the slot immediately', async () => {
    const { customer, resource, service } = await seed('release')
    const startTime = '2027-01-06T10:00:00.000Z'

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(startTime),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    const { released } = await releaseHold({
      config: resolved,
      req: reqFor(),
      token: held.hold.token,
    })
    expect(released).toBe(1)

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('an EXPIRED hold does not block the slot', async () => {
    const { customer, resource, service } = await seed('expired')
    const startTime = '2027-01-07T10:00:00.000Z'

    // Written directly with an expiry in the past — the read-time predicate,
    // not a sweep, is what must ignore it.
    await payload.create({
      collection: col('reservation-holds'),
      data: {
        endTime: '2027-01-07T11:00:00.000Z',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        guestCount: 1,
        resource: resource.id,
        service: service.id,
        startTime,
        token: 'expired-token-fixture',
      },
    })

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        startTime,
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('a hold does not block a DIFFERENT, non-overlapping slot', async () => {
    const { customer, resource, service } = await seed('adjacent')

    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date('2027-01-08T10:00:00.000Z'),
    })
    expect(held.ok).toBe(true)

    const booking = await payload.create({
      collection: col('reservations'),
      data: bookingData(
        { customer: customer.id, resource: resource.id, service: service.id },
        '2027-01-08T14:00:00.000Z',
      ),
    })
    expect(booking.id).toBeDefined()
  })

  test('only ONE of 8 concurrent holds for the same slot succeeds', async () => {
    const { resource, service } = await seed('race')
    const startTime = new Date('2027-01-09T10:00:00.000Z')

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        takeHold({
          config: resolved,
          req: reqFor(),
          resourceId: resource.id,
          serviceId: service.id,
          startTime,
        }),
      ),
    )

    const granted = settled.filter(
      (r) => r.status === 'fulfilled' && r.value.ok === true,
    ).length

    const { totalDocs } = await payload.count({
      collection: col('reservation-holds'),
      where: { resource: { equals: resource.id } },
    })

    // This is the test holds exist for. Without the booking lock underneath,
    // all 8 callers would read "free" before any of them wrote, and all 8 would
    // be told they hold the slot.
    expect({ granted, totalDocs }).toEqual({ granted: 1, totalDocs: 1 })
  })

  test('retry recovers the FULL capacity of a quantity-3 resource under a burst of holds', async () => {
    // A quantity:1 race (the test above) passes whether or not retry works —
    // only one hold should ever be granted there — which is exactly how an inert
    // retry wrapper went unnoticed. This case can only pass if retry genuinely
    // re-runs a hold that lost the lock race: on MongoDB the loser aborts
    // instead of waiting, so a bare burst grants 1 of 3 and two legitimately
    // available holds are refused as "slot taken".
    //
    // Wrapped in retryOnWriteConflict exactly as POST /reserve/hold wraps it,
    // and mirrors dev/concurrency.int.spec.ts's booking equivalent (8 against
    // quantity 3) so the two paths are measured identically.
    const { resource, service } = await seed('race-capacity', 3)
    const startTime = new Date('2027-01-10T10:00:00.000Z')

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        retryOnWriteConflict(() =>
          takeHold({
            config: resolved,
            req: reqFor(),
            resourceId: resource.id,
            serviceId: service.id,
            startTime,
          }),
        ),
      ),
    )

    const granted = settled.filter((r) => r.status === 'fulfilled' && r.value.ok === true).length

    const { totalDocs } = await payload.count({
      collection: col('reservation-holds'),
      where: { resource: { equals: resource.id } },
    })

    // Exactly 3 — not fewer (retry recovered what the bare burst loses) and not
    // more (retry did not defeat the lock).
    expect({ granted, totalDocs }).toEqual({ granted: 3, totalDocs: 3 })
  })

  test('a held slot is absent from getAvailableSlots when holdsSlug is passed', async () => {
    // The read path must agree with the write path. Before holdsSlug was
    // threaded through getAvailableSlots, /reserve/availability, /reserve/slots
    // and the admin slot picker all advertised a held slot as FREE and the
    // customer who clicked it got a 409 from the booking they were invited to
    // make. Asserted BOTH ways in one test so it cannot pass vacuously: the same
    // call without holdsSlug still offers the slot, which is also the
    // slotHolds-disabled behaviour.
    const { resource, service } = await seed('read-path')
    // A Thursday, matching the schedule below; UTC (dev config sets no timezone).
    const dayKey = '2027-01-14'
    await payload.create({
      collection: col('schedules'),
      data: {
        name: 'Hold Read Path Schedule',
        active: true,
        recurringSlots: [{ day: 'thu', endTime: '17:00', startTime: '09:00' }],
        resource: resource.id,
        scheduleType: 'recurring',
      },
    })

    const heldStart = `${dayKey}T10:00:00.000Z`
    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date(heldStart),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    const args = {
      blockingStatuses: resolved.statusMachine.blockingStatuses,
      date: dayKey,
      payload,
      req: reqFor(),
      reservationSlug: 'reservations',
      resourceIds: [resource.id],
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      serviceId: service.id,
      serviceSlug: 'services',
    } as unknown as Parameters<typeof getAvailableSlots>[0]

    const withHolds = await getAvailableSlots({ ...args, holdsSlug: resolved.slugs.holds })
    const withoutHolds = await getAvailableSlots(args)

    const starts = (r: { slots: Array<{ start: Date }> }) =>
      r.slots.map((s) => s.start.toISOString())

    expect(starts(withoutHolds)).toContain(heldStart)
    expect(starts(withHolds)).not.toContain(heldStart)
    // Only the held window disappears — the rest of the day is still bookable.
    expect(starts(withHolds).length).toBeGreaterThan(0)
  })

  test('an authenticated non-privileged user cannot READ holds over the API', async () => {
    // A hold's `token` is a bearer secret: whoever can read it can release
    // someone else's hold or book their slot with it. `admin.hidden` only hides
    // the nav link — Payload still mounts GET /api/reservation-holds — so the
    // collection's own `read` access is the only thing standing in the way.
    // overrideAccess:false is what the REST layer does; the plugin's own
    // internal reads all stay privileged and are covered by every other test in
    // this file.
    const { customer, resource, service } = await seed('secret')
    const held = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date('2027-01-11T10:00:00.000Z'),
    })
    if (!held.ok) {
      throw new Error(`expected hold, got ${held.reason}`)
    }

    const asCustomer = {
      overrideAccess: false,
      user: { ...customer, collection: 'customers' },
    } as unknown as { overrideAccess: false }

    await expect(
      payload.find({ collection: col('reservation-holds'), ...asCustomer }),
    ).rejects.toThrow(/not allowed to perform this action/i)

    await expect(
      payload.findByID({ id: held.hold.id, collection: col('reservation-holds'), ...asCustomer }),
    ).rejects.toThrow(/not allowed to perform this action/i)
  })
})

describe('4.1.2 hold hardening', () => {
  test('a hold cannot start in the past, exceed maxFlexibleDuration, or invert', async () => {
    const flex = await payload.create({
      collection: col('services'),
      data: { name: 'Hold Flex', active: true, duration: 30, durationType: 'flexible' },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Hold Flex R', active: true, quantity: 1, services: [flex.id] },
    })
    const base = { config: resolved, req: reqFor(), resourceId: resource.id, serviceId: flex.id }
    const past = await takeHold({ ...base, startTime: new Date(Date.now() - 3_600_000) })
    expect(past).toMatchObject({ ok: false, reason: 'invalid_window' })
    const start = new Date('2034-01-01T10:00:00Z')
    const huge = await takeHold({ ...base, endTime: new Date('2099-01-01T00:00:00Z'), startTime: start })
    expect(huge).toMatchObject({ ok: false, reason: 'invalid_window' })
    const inverted = await takeHold({ ...base, endTime: new Date(start.getTime() - 60_000), startTime: start })
    expect(inverted).toMatchObject({ ok: false, reason: 'invalid_window' })
    const fine = await takeHold({ ...base, endTime: new Date(start.getTime() + 5_400_000), startTime: start })
    expect(fine.ok).toBe(true)
  })

  test('deleting a resource sweeps expired holds but is blocked by a live one', async () => {
    const { resource, service } = await seed('delguard')
    const live = await takeHold({
      config: resolved,
      req: reqFor(),
      resourceId: resource.id,
      serviceId: service.id,
      startTime: new Date('2034-02-01T10:00:00Z'),
    })
    expect(live.ok).toBe(true)
    if (!live.ok) {return}
    await expect(payload.delete({ id: resource.id, collection: col('resources') })).rejects.toThrow(/active hold/)
    await payload.update({
      id: live.hold.id,
      collection: col(resolved.slugs.holds),
      data: { expiresAt: new Date(Date.now() - 1_000).toISOString() },
    })
    const deleted = await payload.delete({ id: resource.id, collection: col('resources') })
    expect(deleted.id).toBeTruthy()
  })
})

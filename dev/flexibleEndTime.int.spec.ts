/**
 * A reservation whose window cannot be bounded must never be stored.
 *
 * `endTime` is the single most safety-critical value on a reservation: conflict
 * detection, capacity, buffers and availability are all functions of
 * `[startTime, endTime)`. Every one of them SKIPS a row that has no `endTime` —
 * `buildCoarseOverlapQuery` filters on `endTime greater_than`, `itemsToOccupancies`
 * skips an item without one, and `validateConflicts` used to `continue` past it.
 * So an unbounded row is an UNCHECKED row: invisible to every other booking's
 * conflict check, and itself checked against nothing.
 *
 * The multi-resource branch of `calculateEndTime` used to `continue` past a
 * `flexible` item with no `endTime`, which left `latestEnd` underived and stored
 * the reservation with a NULL top-level `endTime` — while the single-resource
 * branch threw for identical input. `expandRequiredResources` is what made that
 * reachable without anyone asking for a multi-resource booking: a service that is
 * both `flexible` and carries `requiredResources` expands to 2+ items on an
 * ordinary one-resource create.
 *
 * Every test here books through the ordinary Local API create path, because that
 * is the path the damage came through.
 */
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { validateConflicts } from '../src/hooks/reservations/validateConflicts.js'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'

/**
 * A service plus the two resources it occupies: the one the caller books, and a
 * `requiredResources` pool the plugin expands into `items[]` on create. That
 * expansion is what pushes an ordinary single-resource booking onto the
 * multi-resource branch.
 */
async function seed(tag: string, durationType: 'fixed' | 'flexible') {
  // The required pool is created first and carries no `services` — Resources
  // may exist before any service references them.
  const pool = await payload.create({
    collection: col('resources'),
    data: { name: `Pool ${tag}`, active: true, quantity: 1 },
  })
  const service = await payload.create({
    collection: col('services'),
    data: {
      name: `Service ${tag}`,
      active: true,
      duration: 60,
      durationType,
      requiredResources: [pool.id],
    },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Resource ${tag}`, active: true, quantity: 1, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `flex-${tag}@example.com`,
      firstName: 'Flex',
      lastName: tag,
      password: 'test1234',
    },
  })
  return { customer, pool, resource, service }
}

/**
 * Run `fn` and return the field-level validation messages it raised.
 *
 * Payload wraps a `ValidationError` in a generic "The following field is
 * invalid: endTime", so asserting on `toThrow(/.../)` cannot tell WHICH rule
 * fired — and every rule in this area is about `endTime`. The specific message
 * and path live in `err.data.errors`. An empty array means it did not throw.
 */
async function validationErrors(
  fn: () => Promise<unknown>,
): Promise<Array<{ message: string; path: string }>> {
  try {
    await fn()
    return []
  } catch (err) {
    return (
      (err as { data?: { errors?: Array<{ message: string; path: string }> } }).data?.errors ?? [
        { message: (err as Error).message, path: '<unknown>' },
      ]
    )
  }
}

/** Reservations belonging to one customer — used to prove nothing was stored. */
async function reservationsFor(customerId: number | string) {
  const { docs } = await payload.find({
    collection: col('reservations'),
    depth: 0,
    limit: 100,
    where: { customer: { equals: customerId } },
  })
  return docs as Array<Record<string, unknown>>
}

describe('flexible services must never store an unbounded window', () => {
  test('rejects a flexible + requiredResources booking that supplies no endTime', async () => {
    const { customer, resource, service } = await seed('reject', 'flexible')

    const errors = await validationErrors(() =>
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-03-01T10:00:00.000Z',
          status: 'pending',
        },
      }),
    )

    expect(errors.map((e) => e.message)).toContain(
      'endTime is required for flexible duration services',
    )
    expect(errors.map((e) => e.path)).toContain('endTime')

    // The throw must come from a beforeChange hook, so nothing is committed.
    expect(await reservationsFor(customer.id)).toHaveLength(0)
  })

  test('the same input on a single-resource flexible service is rejected identically', async () => {
    // No requiredResources -> the single-resource branch. Both branches must
    // refuse the same input; the divergence between them WAS the bug.
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'Service solo', active: true, duration: 60, durationType: 'flexible' },
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'Resource solo', active: true, quantity: 1, services: [service.id] },
    })
    const customer = await payload.create({
      collection: col('customers'),
      data: {
        email: 'flex-solo@example.com',
        firstName: 'Flex',
        lastName: 'solo',
        password: 'test1234',
      },
    })

    const errors = await validationErrors(() =>
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-03-01T10:00:00.000Z',
          status: 'pending',
        },
      }),
    )

    expect(errors.map((e) => e.message)).toContain(
      'endTime is required for flexible duration services',
    )
    expect(errors.map((e) => e.path)).toContain('endTime')

    expect(await reservationsFor(customer.id)).toHaveLength(0)
  })

  test('no NULL-endTime row survives two attempts at the same slot', async () => {
    // The measured damage: two bookings of one flexible slot both stored with a
    // NULL endTime, invisible to conflict detection and to each other. Neither
    // may be stored now — capacity is protected by the row never existing.
    const { customer, resource, service } = await seed('double', 'flexible')

    const attempt = () =>
      payload.create({
        collection: col('reservations'),
        context: { allowConfirmedOnCreate: true },
        data: {
          customer: customer.id,
          resource: resource.id,
          service: service.id,
          startTime: '2027-03-02T12:00:00.000Z',
          status: 'confirmed',
        },
      })

    await expect(attempt()).rejects.toThrow()
    await expect(attempt()).rejects.toThrow()

    const stored = await reservationsFor(customer.id)
    expect(stored).toHaveLength(0)
    expect(stored.filter((d) => !d.endTime)).toHaveLength(0)
  })

  test('rejects an expanded item whose supplied window is inverted', async () => {
    // The single-resource branch has rejected `endTime <= startTime` since the
    // inverted-window fix; the multi-resource branch performed no such check.
    const { customer, resource, service } = await seed('inverted', 'flexible')

    const errors = await validationErrors(() =>
      payload.create({
        collection: col('reservations'),
        data: {
          customer: customer.id,
          endTime: '2027-03-03T09:00:00.000Z',
          resource: resource.id,
          service: service.id,
          startTime: '2027-03-03T10:00:00.000Z',
          status: 'pending',
        },
      }),
    )

    expect(errors.map((e) => e.message)).toContain('endTime must be after startTime')

    expect(await reservationsFor(customer.id)).toHaveLength(0)
  })

  test('accepts a flexible booking with an endTime and bounds every stored item', async () => {
    const { customer, pool, resource, service } = await seed('accept', 'flexible')

    const doc = (await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        endTime: '2027-03-04T12:30:00.000Z',
        resource: resource.id,
        service: service.id,
        startTime: '2027-03-04T10:00:00.000Z',
        status: 'pending',
      },
    })) as unknown as Record<string, unknown>

    // The caller's end is honoured, not overwritten with startTime + duration.
    expect(new Date(doc.endTime as string).toISOString()).toBe('2027-03-04T12:30:00.000Z')

    const items = doc.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    // depth defaults to 2, so relationships come back populated.
    const itemResourceId = (i: Record<string, unknown>) =>
      String((i.resource as { id?: unknown })?.id ?? i.resource)
    expect(items.map(itemResourceId).sort()).toEqual([String(pool.id), String(resource.id)].sort())
    // Every stored item is bounded — an item with no endTime contributes no
    // occupancy, so its resource would be silently free.
    for (const item of items) {
      expect(item.endTime).toBeTruthy()
    }
  })

  test('a bounded flexible booking is conflict-checked on the expanded pool', async () => {
    // Proves the fix does not achieve safety merely by refusing everything: a
    // valid booking still occupies BOTH resources against the next booker.
    const { customer, pool, resource, service } = await seed('conflict', 'flexible')

    await payload.create({
      collection: col('reservations'),
      context: { allowConfirmedOnCreate: true },
      data: {
        customer: customer.id,
        endTime: '2027-03-05T12:00:00.000Z',
        resource: resource.id,
        service: service.id,
        startTime: '2027-03-05T10:00:00.000Z',
        status: 'confirmed',
      },
    })

    // A second service sharing the same required pool: a different bookable
    // resource, but the pool is already taken for that window.
    const otherService = await payload.create({
      collection: col('services'),
      data: {
        name: 'Service conflict other',
        active: true,
        duration: 60,
        durationType: 'flexible',
        requiredResources: [pool.id],
      },
    })
    const otherResource = await payload.create({
      collection: col('resources'),
      data: {
        name: 'Resource conflict other',
        active: true,
        quantity: 1,
        services: [otherService.id],
      },
    })

    await expect(
      payload.create({
        collection: col('reservations'),
        context: { allowConfirmedOnCreate: true },
        data: {
          customer: customer.id,
          endTime: '2027-03-05T12:00:00.000Z',
          resource: otherResource.id,
          service: otherService.id,
          startTime: '2027-03-05T10:00:00.000Z',
          status: 'confirmed',
        },
      }),
    ).rejects.toThrow()

    // Only the first booking exists; `resource` above is the one it holds.
    expect(await reservationsFor(customer.id)).toHaveLength(1)
    expect(String(resource.id)).toBeTruthy()
  })

  test('fixed multi-resource bookings are unchanged: per-item ends and a top-level span', async () => {
    const { customer, resource, service } = await seed('fixed', 'fixed')

    const doc = (await payload.create({
      collection: col('reservations'),
      data: {
        customer: customer.id,
        resource: resource.id,
        service: service.id,
        startTime: '2027-03-06T10:00:00.000Z',
        status: 'pending',
      },
    })) as unknown as Record<string, unknown>

    // duration 60 -> every item ends at 11:00, and the top-level span with it.
    expect(new Date(doc.endTime as string).toISOString()).toBe('2027-03-06T11:00:00.000Z')

    const items = doc.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(new Date(item.endTime as string).toISOString()).toBe('2027-03-06T11:00:00.000Z')
    }
  })
})

describe('validateConflicts refuses what it cannot check', () => {
  test('an item with no endTime is rejected rather than skipped', async () => {
    // Defense in depth. After the calculateEndTime chokepoint this state is
    // unreachable through the collection's own hook chain, so it is exercised
    // by invoking the hook directly — a host that reorders or replaces hooks
    // via `collectionOverrides.reservations` can still reach it, and silently
    // checking nothing is the worst available response.
    const hook = validateConflicts(resolveConfig({}))

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hook as any)({
        context: {},
        data: {
          resource: 'resource-id',
          service: 'service-id',
          startTime: '2027-03-07T10:00:00.000Z',
        },
        operation: 'create',
        req: { payload },
      }),
    ).rejects.toThrow(/endTime/)
  })
})

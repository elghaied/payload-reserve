import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { externalBusyState } from './helpers/externalBusyState.js'

let payload: Payload
const col = (slug: string) => slug as 'users'

afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})
beforeEach(() => {
  externalBusyState.intervals = []
  externalBusyState.throwError = false
})

async function fixtures(tag: string, quantity = 1) {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `Ext Service ${tag}`, active: true, duration: 30, price: 10 },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `Ext Resource ${tag}`, active: true, quantity, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `ext-${tag}@example.com`,
      firstName: 'Ext',
      lastName: tag,
      password: 'testpass123',
    },
  })
  return { customer, resource, service }
}

// status 'pending' (the dev-suite convention): validateStatusTransition rejects
// 'confirmed' on create without a privileged user; validateConflicts runs either way.
const createReservation = (f: Awaited<ReturnType<typeof fixtures>>, startTime: string) =>
  payload.create({
    collection: col('reservations'),
    data: {
      customer: f.customer.id,
      resource: f.resource.id,
      service: f.service.id,
      startTime,
      status: 'pending',
    },
  })

describe('getExternalBusy enforcement (checkAvailability via validateConflicts)', () => {
  it('rejects a booking overlapping an external interval', async () => {
    const f = await fixtures('block')
    externalBusyState.intervals = [
      { end: '2026-08-03T10:00:00.000Z', label: 'Google', start: '2026-08-03T09:00:00.000Z' },
    ]
    await expect(createReservation(f, '2026-08-03T09:15:00.000Z')).rejects.toThrow()
  })

  it('allows a booking that does not overlap any external interval', async () => {
    const f = await fixtures('allow')
    externalBusyState.intervals = [
      { end: '2026-08-03T10:00:00.000Z', start: '2026-08-03T09:00:00.000Z' },
    ]
    const res = await createReservation(f, '2026-08-03T14:00:00.000Z')
    expect(res.id).toBeTruthy()
  })

  it('fails OPEN when the resolver throws', async () => {
    const f = await fixtures('failopen')
    externalBusyState.throwError = true
    const res = await createReservation(f, '2026-08-04T09:00:00.000Z')
    expect(res.id).toBeTruthy()
  })

  it('blocks the WHOLE resource: quantity > 1 still rejects (units = quantity, not 1)', async () => {
    const f = await fixtures('capacity', 3)
    externalBusyState.intervals = [
      { end: '2026-08-05T10:00:00.000Z', start: '2026-08-05T09:00:00.000Z' },
    ]
    // With units: 1 this would pass (1 + 1 <= 3). Full block must reject.
    await expect(createReservation(f, '2026-08-05T09:15:00.000Z')).rejects.toThrow()
  })
})

describe('resource-availability endpoint external[]', () => {
  it('returns resolver intervals as external, separate from busy; [] when resolver throws', async () => {
    const f = await fixtures('display')
    const { buildResourceAvailability } = await import('../src/endpoints/resourceAvailability.js')
    externalBusyState.intervals = [
      { end: '2026-08-10T10:00:00.000Z', label: 'Google', start: '2026-08-10T09:00:00.000Z' },
    ]
    const { externalBusyResolver } = await import('./helpers/externalBusyState.js')
    const args = {
      blockingStatuses: ['pending', 'confirmed'],
      end: new Date('2026-08-11T00:00:00.000Z'),
      getExternalBusy: externalBusyResolver,
      payload,
      req: { payload } as never,
      reservationSlug: 'reservations',
      resourceId: f.resource.id,
      resourceSlug: 'resources',
      scheduleSlug: 'schedules',
      start: new Date('2026-08-10T00:00:00.000Z'),
      timeZone: 'UTC',
    }
    const result = await buildResourceAvailability(args)
    expect(result?.external).toEqual([
      { end: '2026-08-10T10:00:00.000Z', label: 'Google', start: '2026-08-10T09:00:00.000Z' },
    ])
    expect(result?.busy).toEqual([]) // external never leaks into busy

    externalBusyState.throwError = true
    const failed = await buildResourceAvailability(args)
    expect(failed?.external).toEqual([]) // fail-open: grid renders, just unshaded
  })
})

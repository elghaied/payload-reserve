import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServiceResourcesPayload } from './helpers/serviceResourcesPayload.js'

let payload: Payload
let stop: () => Promise<void>

beforeAll(async () => {
  const built = await buildServiceResourcesPayload()
  payload = built.payload
  stop = built.stop
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('Services.resources join', () => {
  it('lists the resources whose services include this service', async () => {
    const svc = await payload.create({
      collection: 'services',
      data: { name: 'Haircut', duration: 30, durationType: 'fixed' },
    })
    const res = await payload.create({
      collection: 'resources',
      data: { name: 'Chair A', quantity: 1, services: [svc.id] },
    })

    const read = await payload.findByID({ id: svc.id, collection: 'services', depth: 0 })
    const ids = (read.resources as { docs: Array<{ id: unknown } | string> }).docs.map((d) =>
      String(typeof d === 'object' ? d.id : d),
    )
    expect(ids).toEqual([String(res.id)])
  })

  it('returns an empty docs array when nothing references the service', async () => {
    const svc = await payload.create({
      collection: 'services',
      data: { name: 'Lonely', duration: 30, durationType: 'fixed' },
    })
    const read = await payload.findByID({ id: svc.id, collection: 'services', depth: 0 })
    expect((read.resources as { docs: unknown[] }).docs).toEqual([])
  })

  it(
    'returns more than 10 resources — defaultLimit is raised',
    async () => {
      // Joins default to defaultLimit: 10 (buildJoinAggregation). Without an
      // explicit defaultLimit, a service with 13 resources silently shows 10.
      const svc = await payload.create({
        collection: 'services',
        data: { name: 'Popular', duration: 30, durationType: 'fixed' },
      })
      for (let i = 0; i < 13; i++) {
        await payload.create({
          collection: 'resources',
          data: { name: `R${i}`, quantity: 1, services: [svc.id] },
        })
      }
      const read = await payload.findByID({ id: svc.id, collection: 'services', depth: 0 })
      expect((read.resources as { docs: unknown[] }).docs.length).toBe(13)
    },
    30_000,
  )

  it('leaves existing Services behaviour unchanged', async () => {
    const svc = await payload.create({
      collection: 'services',
      data: { name: 'Unchanged', bufferTimeBefore: 5, duration: 30, durationType: 'fixed' },
    })
    expect(svc.name).toBe('Unchanged')
    expect(svc.bufferTimeBefore).toBe(5)
    expect(svc.active).toBe(true)
  })
})

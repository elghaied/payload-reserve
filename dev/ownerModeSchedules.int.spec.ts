import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServiceResourcesAccessPayload } from './helpers/serviceResourcesAccessPayload.js'

/** Payload wraps a hook's message; the real text sits at data.errors[0].message. */
const validation = (re: RegExp) => ({ data: { errors: [{ message: expect.stringMatching(re) }] } })

/**
 * resourceOwnerMode: `create` on Schedules is any authenticated user, but the
 * resource it names must be the caller's own — a years-long exception posted
 * onto another owner's resource used to block it for everyone. And an owner
 * may not hand their resource to another id.
 */

let payload: Payload
let stop: () => Promise<void>

type Doc = { id: number | string } & Record<string, unknown>
let admin: Doc
let staffA: Doc
let staffB: Doc
let resourceA: Doc
let resourceB: Doc

beforeAll(async () => {
  const built = await buildServiceResourcesAccessPayload()
  payload = built.payload
  stop = built.stop
  admin = (await payload.create({ collection: 'users', data: { email: 'oms-admin@example.com', password: 'testpass123', role: 'admin' } })) as Doc
  staffA = (await payload.create({ collection: 'users', data: { email: 'oms-a@example.com', password: 'testpass123', role: 'staff' } })) as Doc
  staffB = (await payload.create({ collection: 'users', data: { email: 'oms-b@example.com', password: 'testpass123', role: 'staff' } })) as Doc
  const service = await payload.create({ collection: 'services', data: { name: 'OMS Cut', duration: 30 } })
  resourceA = (await payload.create({ collection: 'resources', data: { name: 'OMS A', services: [service.id] }, overrideAccess: false, user: staffA as never })) as Doc
  resourceB = (await payload.create({ collection: 'resources', data: { name: 'OMS B', services: [service.id] }, overrideAccess: false, user: staffB as never })) as Doc
}, 60_000)

afterAll(async () => {
  await stop?.()
})

const schedule = (resource: Doc) => ({
  name: 'x',
  exceptions: [{ date: '2026-09-01', endDate: '2036-12-31' }],
  resource: resource.id,
  scheduleType: 'recurring' as const,
})

describe('schedule ownership under resourceOwnerMode', () => {
  it('an owner cannot create a schedule on another owner’s resource', async () => {
    await expect(
      payload.create({ collection: 'schedules', data: schedule(resourceB), overrideAccess: false, user: staffA as never }),
    ).rejects.toMatchObject(validation(/resources you own/))
  })

  it('an owner can schedule their own resource, and an admin can schedule any', async () => {
    const own = await payload.create({ collection: 'schedules', data: schedule(resourceA), overrideAccess: false, user: staffA as never })
    expect(own.id).toBeTruthy()
    const any = await payload.create({ collection: 'schedules', data: schedule(resourceB), overrideAccess: false, user: admin as never })
    expect(any.id).toBeTruthy()
  })

  it('an owner cannot move their own schedule onto another owner’s resource', async () => {
    const own = await payload.create({ collection: 'schedules', data: schedule(resourceA), overrideAccess: false, user: staffA as never })
    await expect(
      payload.update({ id: own.id, collection: 'schedules', data: { resource: resourceB.id }, overrideAccess: false, user: staffA as never }),
    ).rejects.toMatchObject(validation(/resources you own/))
  })
})

describe('resource owner re-assignment', () => {
  it('an owner cannot hand their resource to another user; an admin can', async () => {
    const kept = await payload.update({
      id: resourceA.id, collection: 'resources', data: { owner: staffB.id }, depth: 0, overrideAccess: false, user: staffA as never,
    })
    expect(String(kept.owner)).toBe(String(staffA.id))
    const moved = await payload.update({
      id: resourceA.id, collection: 'resources', data: { owner: staffB.id }, depth: 0, overrideAccess: false, user: admin as never,
    })
    expect(String(moved.owner)).toBe(String(staffB.id))
  })
})

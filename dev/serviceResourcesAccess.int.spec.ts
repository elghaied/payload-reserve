import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServiceResourcesAccessPayload } from './helpers/serviceResourcesAccessPayload.js'

// Join access control only applies when overrideAccess is false —
// sanitizeJoinQuery skips executeAccess otherwise. REST requests enforce by
// default; Local API calls default to overrideAccess: true and will populate
// the join unenforced. That is standard Payload behaviour for every field,
// not something specific to this one.

let payload: Payload
let stop: () => Promise<void>

beforeAll(async () => {
  const built = await buildServiceResourcesAccessPayload()
  payload = built.payload
  stop = built.stop
}, 60_000)

afterAll(async () => {
  await stop?.()
})

type CreatedUser = { id: number | string } & Record<string, unknown>

describe('Services.resources join — owner isolation (resourceOwnerMode)', () => {
  let adminUser: CreatedUser
  let staffA: CreatedUser
  let sharedServiceId: number | string
  let staffBResourceId: number | string

  beforeAll(async () => {
    adminUser = await payload.create({
      collection: 'users',
      data: { email: 'owner-admin@example.com', password: 'testpass123', role: 'admin' },
    })
    staffA = await payload.create({
      collection: 'users',
      data: { email: 'owner-staff-a@example.com', password: 'testpass123', role: 'staff' },
    })
    const staffB = await payload.create({
      collection: 'users',
      data: { email: 'owner-staff-b@example.com', password: 'testpass123', role: 'staff' },
    })

    const sharedService = await payload.create({
      collection: 'services',
      data: { name: 'Shared Cut', duration: 30, durationType: 'fixed' },
    })
    sharedServiceId = sharedService.id

    // Owner is stamped by the resource's own beforeChange hook from req.user —
    // creating "as" staffA/staffB is how each resource ends up owned by them.
    await payload.create({
      collection: 'resources',
      data: { name: 'Chair A', quantity: 1, services: [sharedServiceId] },
      overrideAccess: false,
      user: staffA,
    })
    const staffBResource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair B', quantity: 1, services: [sharedServiceId] },
      overrideAccess: false,
      user: staffB,
    })
    staffBResourceId = staffBResource.id
  }, 30_000)

  it('a staff user does not see another owner resources on a service', async () => {
    const asA = await payload.findByID({
      id: sharedServiceId,
      collection: 'services',
      depth: 0,
      overrideAccess: false,
      user: staffA,
    })
    const ids = (asA.resources as { docs: Array<{ id: unknown } | string> }).docs.map((d) =>
      String(typeof d === 'object' ? d.id : d),
    )
    expect(ids).not.toContain(String(staffBResourceId))
  })

  it('an admin sees every resource on the service', async () => {
    const asAdmin = await payload.findByID({
      id: sharedServiceId,
      collection: 'services',
      depth: 0,
      overrideAccess: false,
      user: adminUser,
    })
    expect((asAdmin.resources as { docs: unknown[] }).docs.length).toBe(2)
  })
})

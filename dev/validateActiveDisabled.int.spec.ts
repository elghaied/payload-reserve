import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildEnforceActiveOffPayload } from './helpers/enforceActiveOffPayload.js'

let payload: Payload
let stop: () => Promise<void>

beforeAll(async () => {
  const built = await buildEnforceActiveOffPayload()
  payload = built.payload
  stop = built.stop
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('validateActive hook (enforceActive: false)', () => {
  it('does nothing when enforceActive is false', async () => {
    const customer = await payload.create({
      collection: 'customers',
      data: {
        email: 'enforce-active-off@example.com',
        firstName: 'Off',
        lastName: 'Switch',
        password: 'testpass123',
      },
    })
    const inactiveService = await payload.create({
      collection: 'services',
      data: { name: 'Retired Off', active: false, duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Off', quantity: 1 },
    })

    const r = await payload.create({
      collection: 'reservations',
      data: {
        customer: customer.id,
        resource: resource.id,
        service: inactiveService.id,
        startTime: new Date(Date.now() + 48 * 3600_000).toISOString(),
      },
    })
    expect(r.id).toBeDefined()
  })
})

import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extractErrorMessage } from '../src/utilities/extractErrorMessage.js'
import { buildServiceResourcesPayload } from './helpers/serviceResourcesPayload.js'

let payload: Payload
let stop: () => Promise<void>
let serviceId: number | string
let resourceId: number | string
let customerId: number | string

const col = (slug: string) => slug as 'users'

beforeAll(async () => {
  const built = await buildServiceResourcesPayload()
  payload = built.payload
  stop = built.stop

  const service = await payload.create({
    collection: col('services'),
    data: {
      name: 'Notice Period Service',
      active: true,
      bufferTimeAfter: 0,
      bufferTimeBefore: 0,
      duration: 60,
    },
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: 'Notice Period Resource', active: true, services: [service.id] },
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: 'detail-error-shape@example.com',
      firstName: 'Detail',
      lastName: 'Error',
      password: 'testpass123',
    },
  })
  serviceId = service.id
  resourceId = resource.id
  customerId = customer.id
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('Payload ValidationError REST shape', () => {
  it('nests the hook message where extractErrorMessage looks for it', async () => {
    // A reservation starting in 2 hours, under the 24h default notice period.
    const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const created = await payload.create({
      collection: 'reservations',
      context: { allowConfirmedOnCreate: true },
      data: { customer: customerId, resource: resourceId, service: serviceId, startTime },
    })

    let thrown: unknown
    try {
      await payload.update({
        id: created.id,
        collection: 'reservations',
        data: { status: 'cancelled' },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown, 'cancelling inside the notice period must throw').toBeTruthy()

    // Reproduce exactly what the REST layer sends to the browser.
    // `formatErrors` is exported from the package root (payload/dist/index.d.ts:645).
    const { formatErrors } = await import('payload')
    const body = formatErrors(thrown as Error)

    // The generic wrapper is what a naive reader would surface — assert it is
    // NOT what the user sees.
    expect(body.errors[0].message).toContain('following field')
    const message = extractErrorMessage(body, 'FALLBACK')
    expect(message).not.toBe('FALLBACK')
    expect(message).not.toBe(body.errors[0].message)
    expect(message.toLowerCase()).toContain('hour')
  })
})

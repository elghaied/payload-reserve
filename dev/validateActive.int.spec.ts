import type { Payload } from 'payload'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildServiceResourcesPayload } from './helpers/serviceResourcesPayload.js'

let payload: Payload
let stop: () => Promise<void>
let customerId: number | string

const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

function bookingFor(
  service: { id: number | string },
  resource: { id: number | string },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    customer: customerId,
    resource: resource.id,
    service: service.id,
    startTime: future(48),
    ...overrides,
  }
}

// Payload's ValidationError.message is a generic "The following field is
// invalid: <path>" summary — the translated per-field message we throw lives
// in `error.data.errors[].message`, which JSON.stringify (unlike `.message`)
// serializes. Assert against the stringified error rather than `.message`.
async function expectValidationMessage(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e) => e,
  )
  expect(err, 'expected the promise to reject').toBeDefined()
  expect(JSON.stringify(err)).toMatch(pattern)
}

beforeAll(async () => {
  const built = await buildServiceResourcesPayload()
  payload = built.payload
  stop = built.stop

  const customer = await payload.create({
    collection: 'customers',
    data: {
      email: 'active-enforcement@example.com',
      firstName: 'Active',
      lastName: 'Enforcement',
      password: 'testpass123',
    },
  })
  customerId = customer.id
}, 60_000)

afterAll(async () => {
  await stop?.()
})

describe('validateActive hook', () => {
  it('rejects a booking for an inactive service', async () => {
    const svc = await payload.create({
      collection: 'services',
      data: { name: 'Retired A', active: false, duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active A', quantity: 1 },
    })

    await expectValidationMessage(
      payload.create({ collection: 'reservations', data: bookingFor(svc, resource) }),
      /not active/i,
    )
  })

  it('rejects a booking for an inactive resource', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Standard B', duration: 30, durationType: 'fixed' },
    })
    const res = await payload.create({
      collection: 'resources',
      data: { name: 'Broken Chair B', active: false, quantity: 1 },
    })

    await expectValidationMessage(
      payload.create({ collection: 'reservations', data: bookingFor(service, res) }),
      /not active/i,
    )
  })

  it('names the offending entity in the message', async () => {
    const inactiveService = await payload.create({
      collection: 'services',
      data: { name: 'Retired', active: false, duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active C', quantity: 1 },
    })

    await expectValidationMessage(
      payload.create({ collection: 'reservations', data: bookingFor(inactiveService, resource) }),
      /Retired/,
    )
  })

  it('uses an indexed path for a multi-resource booking', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Standard D', duration: 30, durationType: 'fixed' },
    })
    const resourceOne = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active D1', quantity: 1 },
    })
    const resourceTwo = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Inactive D2', active: false, quantity: 1 },
    })
    const startTime = future(48)

    const err = await payload
      .create({
        collection: 'reservations',
        data: {
          customer: customerId,
          items: [
            { resource: resourceOne.id, startTime },
            { resource: resourceTwo.id, startTime },
          ],
          resource: resourceOne.id,
          service: service.id,
          startTime,
        },
      })
      .catch((e) => e)

    expect(JSON.stringify(err)).toMatch(/items\.1\.resource/)
  })

  it('lets an existing booking be cancelled after its service is deactivated', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Cancel-me Service', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active E', quantity: 1 },
    })
    const r = await payload.create({
      collection: 'reservations',
      data: bookingFor(service, resource),
    })

    await payload.update({ id: service.id, collection: 'services', data: { active: false } })

    // Must NOT throw — otherwise a discontinued service's bookings become
    // permanently uneditable, including uncancellable.
    const cancelled = await payload.update({
      id: r.id,
      collection: 'reservations',
      data: { status: 'cancelled' },
    })
    expect(cancelled.status).toBe('cancelled')
  })

  it('rejects when a service auto-expands an inactive required pool', async () => {
    // Proves ordering: validateActive must run AFTER expandRequiredResources,
    // which injects requiredResources into items[] with no active check.
    const pool = await payload.create({
      collection: 'resources',
      data: { name: 'Inactive Pool F', active: false, quantity: 1 },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active F', quantity: 1 },
    })
    const service = await payload.create({
      collection: 'services',
      data: {
        name: 'Needs Pool F',
        duration: 30,
        durationType: 'fixed',
        requiredResources: [pool.id],
      },
    })

    await expectValidationMessage(
      payload.create({ collection: 'reservations', data: bookingFor(service, resource) }),
      /not active/i,
    )
  })

  it('rejects rescheduling an existing booking onto a deactivated resource', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Reschedule Service G', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active G', quantity: 1 },
    })
    const r = await payload.create({
      collection: 'reservations',
      data: bookingFor(service, resource),
    })

    await payload.update({ id: resource.id, collection: 'resources', data: { active: false } })

    // The (service, resource) pair is unchanged, so the pair-only skip would
    // wave this through — but availability offers no slot on an inactive
    // resource, so the write path must refuse it too.
    await expectValidationMessage(
      payload.update({
        id: r.id,
        collection: 'reservations',
        data: { startTime: future(72) },
      }),
      /not active/i,
    )
  })

  it('still allows confirm and non-scheduling edits after deactivation', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Notes Service H', duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active H', quantity: 1 },
    })
    const r = await payload.create({
      collection: 'reservations',
      data: bookingFor(service, resource),
    })

    await payload.update({ id: resource.id, collection: 'resources', data: { active: false } })

    // Confirming is a status-only change. This is exactly why the call site in
    // Step 7 omits blockingStatuses: with them, schedulingFieldsChanged reports
    // pending -> confirmed as a change and the booking becomes stranded.
    // (validateStatusTransition gates status on `create` only; on update the
    // transition machine alone applies, and pending -> confirmed is valid.)
    const confirmed = await payload.update({
      id: r.id,
      collection: 'reservations',
      data: { status: 'confirmed' },
    })
    expect(confirmed.status).toBe('confirmed')

    const updated = await payload.update({
      id: r.id,
      collection: 'reservations',
      data: { notes: 'called ahead' },
    })
    expect(updated.notes).toBe('called ahead')
  })

  it('rejects an update that swaps in a newly referenced inactive service', async () => {
    const service = await payload.create({
      collection: 'services',
      data: { name: 'Original Service I', duration: 30, durationType: 'fixed' },
    })
    const inactiveService = await payload.create({
      collection: 'services',
      data: { name: 'Retired Service I', active: false, duration: 30, durationType: 'fixed' },
    })
    const resource = await payload.create({
      collection: 'resources',
      data: { name: 'Chair Active I', quantity: 1 },
    })
    const r = await payload.create({
      collection: 'reservations',
      data: bookingFor(service, resource),
    })

    // A pair the booking never had before, so previousKeys cannot skip it.
    await expectValidationMessage(
      payload.update({
        id: r.id,
        collection: 'reservations',
        data: { service: inactiveService.id },
      }),
      /not active/i,
    )
  })
})

// Payload 4 runs the hook chain with `operation: 'validate'` (payload.validate /
// POST /api/<slug>/:id/validate) without saving. The verdict must match what a
// real create/update would do.
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload
afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'
const DAY = 86_400_000

/** A validate run reports invalid either by result or by throwing. */
const verdict = async (id: unknown, data: Record<string, unknown>) => {
  try {
    const out = await payload.validate({
      id: id as string,
      collection: col('reservations'),
      data: data as never,
      overrideAccess: true,
    })
    return out.valid
  } catch {
    return false
  }
}

const setup = async (tag: string) => {
  const service = await payload.create({
    collection: col('services'),
    data: { name: `validate ${tag} svc`, active: true, duration: 60 } as never,
    overrideAccess: true,
  })
  const resource = await payload.create({
    collection: col('resources'),
    data: { name: `validate ${tag} res`, active: true } as never,
    overrideAccess: true,
  })
  const customer = await payload.create({
    collection: col('customers'),
    data: {
      email: `validate-${tag}-${Date.now()}@example.com`,
      firstName: 'V',
      lastName: tag,
      password: 'test1234',
    } as never,
    overrideAccess: true,
  })
  const reservation = await payload.create({
    collection: col('reservations'),
    data: {
      customer: customer.id,
      resource: resource.id,
      service: service.id,
      startTime: new Date(Date.now() + 3 * DAY).toISOString(),
    } as never,
    overrideAccess: true,
  })
  return { reservation, resource, service }
}

describe('validate operation on an existing reservation', () => {
  test('a benign edit stays valid after the service is deactivated', async () => {
    const { reservation, service } = await setup('inactive')
    await payload.update({
      id: service.id,
      collection: col('services'),
      data: { active: false } as never,
      overrideAccess: true,
    })
    // The real update succeeds…
    await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { notes: 'real edit' } as never,
      overrideAccess: true,
    })
    // …so the dry run must agree instead of checking it as a new booking.
    expect(await verdict(reservation.id, { notes: 'dry run' })).toBe(true)
  })

  test('an edit that conflicts only with the row itself stays valid', async () => {
    const { reservation } = await setup('self')
    expect(await verdict(reservation.id, { notes: 'dry run' })).toBe(true)
  })

  test('a transition out of a terminal status is invalid', async () => {
    const { reservation } = await setup('terminal')
    await payload.update({
      id: reservation.id,
      collection: col('reservations'),
      data: { cancellationReason: 'test', status: 'cancelled' } as never,
      overrideAccess: true,
    })
    expect(await verdict(reservation.id, { status: 'completed' })).toBe(false)
  })
})

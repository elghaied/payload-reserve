// GET /reserve/held backs the "Held" markers in the admin availability grid.
import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createHeldSlotsEndpoint } from '../src/endpoints/heldSlots.js'
import { createHoldSlotEndpoint } from '../src/endpoints/holdSlot.js'

let payload: Payload
afterAll(async () => {
  await payload.destroy()
})
beforeAll(async () => {
  payload = await getPayload({ config })
})

const col = (slug: string) => slug as 'users'
const resolved = resolveConfig({ slotHolds: { enabled: true, ttlMinutes: 10 } })
const DAY = 86_400_000
const staff = { id: 'staff-1', collection: 'users' }

const held = async (query: Record<string, string>, user: unknown) => {
  const res = await (createHeldSlotsEndpoint(resolved).handler as (r: never) => Promise<Response>)({
    payload,
    url: `http://localhost/api/reserve/held?${new URLSearchParams(query)}`,
    user,
  } as never)
  return { body: (await res.json()) as Record<string, unknown>, status: res.status }
}

describe('GET /reserve/held', () => {
  test('lists an unexpired hold for staff, without its token', async () => {
    const service = await payload.create({
      collection: col('services'),
      data: { name: 'held svc', active: true, duration: 60 } as never,
      overrideAccess: true,
    })
    const resource = await payload.create({
      collection: col('resources'),
      data: { name: 'held res', active: true } as never,
      overrideAccess: true,
    })
    const startTime = new Date(Date.now() + 2 * DAY).toISOString()
    const taken = await (
      createHoldSlotEndpoint(resolved).handler as (r: never) => Promise<Response>
    )({
      json: () => Promise.resolve({ resource: resource.id, service: service.id, startTime }),
      payload,
      user: null,
    } as never)
    expect(taken.status).toBe(201)

    const range = {
      end: new Date(Date.now() + 7 * DAY).toISOString(),
      resources: String(resource.id),
      start: new Date().toISOString(),
    }
    const out = await held(range, staff)
    expect(out.status).toBe(200)
    const holds = out.body.holds as Array<Record<string, unknown>>
    expect(holds).toHaveLength(1)
    expect(String(holds[0].resource)).toBe(String(resource.id))
    expect(new Date(holds[0].startTime as string).toISOString()).toBe(startTime)
    expect(JSON.stringify(out.body)).not.toContain('token')

    // Outside the window: nothing.
    const later = await held(
      { ...range, end: new Date(Date.now() + 9 * DAY).toISOString(), start: range.end },
      staff,
    )
    expect(later.body.holds).toEqual([])
  })

  test('refuses anonymous callers and customers', async () => {
    const range = { end: new Date(Date.now() + DAY).toISOString(), resources: 'x', start: new Date().toISOString() }
    expect((await held(range, null)).status).toBe(401)
    expect((await held(range, { id: 'c1', collection: 'customers' })).status).toBe(403)
  })

  test('rejects a missing or oversized request', async () => {
    expect((await held({ resources: 'x' }, staff)).status).toBe(400)
    const many = Array.from({ length: 101 }, (_, i) => `r${i}`).join(',')
    expect(
      (await held({ end: new Date(Date.now() + DAY).toISOString(), resources: many, start: new Date().toISOString() }, staff)).status,
    ).toBe(400)
  })
})

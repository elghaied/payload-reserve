import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { createReserveClient, ReserveError } from '../src/exports/sdk.js'

type Call = { init: RequestInit; url: string }

const fakeFetch = (status: number, body: unknown) => {
  const calls: Call[] = []
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ init, url })
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('payload-reserve/sdk', () => {
  test('getSlots builds the query and returns the body', async () => {
    const { calls, impl } = fakeFetch(200, { date: '2026-06-01', guestCount: 2, slots: [] })
    const reserve = createReserveClient({ baseURL: 'https://shop.test/', fetch: impl })
    const out = await reserve.getSlots({
      date: '2026-06-01',
      guestCount: 2,
      resource: 'r1',
      resources: ['r2', 'r3'],
      service: 's1',
    })
    expect(out.slots).toEqual([])
    expect(calls[0].url).toBe(
      'https://shop.test/api/reserve/slots?date=2026-06-01&resource=r1&service=s1&guestCount=2&resources=r2%2Cr3',
    )
    expect(calls[0].init.credentials).toBe('include')
  })

  test('book serializes dates and posts JSON', async () => {
    const { calls, impl } = fakeFetch(201, { id: 'b1', startTime: 'x', status: 'pending' })
    const reserve = createReserveClient({ apiRoute: '/cms', fetch: impl })
    const start = new Date('2026-06-01T10:00:00.000Z')
    const doc = await reserve.book({ holdToken: 'h', resource: 1, service: 2, startTime: start })
    expect(doc.id).toBe('b1')
    expect(calls[0].url).toBe('/cms/reserve/book')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      holdToken: 'h',
      resource: 1,
      service: 2,
      startTime: '2026-06-01T10:00:00.000Z',
    })
  })

  test('a refused hold throws with its machine code and detail', async () => {
    const { impl } = fakeFetch(429, { detail: 'You already hold 5 slots.', error: 'hold_limit_reached' })
    const err = await createReserveClient({ fetch: impl })
      .hold({ resource: 1, service: 2, startTime: '2026-06-01T10:00:00.000Z' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ReserveError)
    expect(err).toMatchObject({
      code: 'hold_limit_reached',
      detail: 'You already hold 5 slots.',
      retryable: false,
      status: 429,
    })
  })

  test('a lost race is retryable, with a sentence rather than a code', async () => {
    const { impl } = fakeFetch(409, { error: 'That slot is being booked by someone else.', retryable: true })
    const err = (await createReserveClient({ fetch: impl })
      .book({ resource: 1, service: 2, startTime: '2026-06-01T10:00:00.000Z' })
      .catch((e: unknown) => e)) as ReserveError
    expect(err.retryable).toBe(true)
    expect(err.code).toBeUndefined()
    expect(err.message).toBe('That slot is being booked by someone else.')
  })

  test("a hook's validation error surfaces the hook's own message and path", async () => {
    const body = {
      errors: [
        {
          name: 'ValidationError',
          data: { errors: [{ message: 'This time slot is already booked', path: 'startTime' }] },
          message: 'The following field is invalid: startTime',
        },
      ],
    }
    const { impl } = fakeFetch(400, body)
    const err = (await createReserveClient({ fetch: impl })
      .book({ resource: 1, service: 2, startTime: '2026-06-01T10:00:00.000Z' })
      .catch((e: unknown) => e)) as ReserveError
    expect(err.message).toBe('This time slot is already booked')
    expect(err.path).toBe('startTime')
  })

  test('cancel errors read the unified error key', async () => {
    const { impl } = fakeFetch(403, { error: 'Forbidden', message: 'Forbidden' })
    const err = (await createReserveClient({ fetch: impl })
      .cancel({ reservationId: 'b1', token: 'nope' })
      .catch((e: unknown) => e)) as ReserveError
    expect(err.status).toBe(403)
    expect(err.message).toBe('Forbidden')
  })

  test('the module stays browser-safe: no payload, react or @payloadcms import', () => {
    for (const file of ['src/exports/sdk.ts', 'src/utilities/extractErrorMessage.ts']) {
      const source = readFileSync(file, 'utf8')
      const runtimeImports = [...source.matchAll(/^import (?!type )[^\n]* from '([^']+)'/gm)].map(
        (m) => m[1],
      )
      for (const spec of runtimeImports) {
        expect(spec.startsWith('.')).toBe(true)
      }
    }
  })
})

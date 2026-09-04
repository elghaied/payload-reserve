import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'
import { flattenRelations } from '../src/utilities/flattenRelations.js'
import { flexibleWindowProblem } from '../src/utilities/flexibleWindow.js'
import { composeAccess } from '../src/utilities/ownerAccess.js'
import { mergeRanges } from '../src/utilities/scheduleWindow.js'

describe('flexibleWindowProblem', () => {
  const config = { maxFlexibleDuration: 1440 }
  const start = new Date('2030-01-01T10:00:00Z')
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
  it('rejects inverted, too short, too long; accepts in range', () => {
    expect(flexibleWindowProblem({ config, end: at(0), service: { duration: 30 }, start })).toMatch(/after startTime/)
    expect(flexibleWindowProblem({ config, end: at(10), service: { duration: 30 }, start })).toMatch(/at least 30/)
    expect(flexibleWindowProblem({ config, end: at(1441), service: { duration: 30 }, start })).toMatch(/exceed 1440/)
    expect(flexibleWindowProblem({ config, end: at(90), service: { duration: 30 }, start })).toBeNull()
    expect(flexibleWindowProblem({ config, end: new Date('x'), service: {}, start })).toMatch(/valid date/)
  })
})

describe('mergeRanges', () => {
  it('merges overlapping and touching ranges, keeps gaps', () => {
    const r = (a: number, b: number) => ({ end: new Date(b * 3_600_000), start: new Date(a * 3_600_000) })
    const merged = mergeRanges([r(9, 12), r(12, 13), r(14, 17), r(10, 11)])
    expect(merged.map((x) => [x.start.getTime() / 3_600_000, x.end.getTime() / 3_600_000])).toEqual([[9, 13], [14, 17]])
  })
})

describe('composeAccess', () => {
  it('an explicit undefined in the override does not clobber the base rule', () => {
    const base = { read: () => false }
    const out = composeAccess(base, { read: undefined, update: () => true })
    expect(out.read).toBe(base.read)
    expect(typeof out.update).toBe('function')
  })
})

describe('flattenRelations', () => {
  it('collapses populated relationships, including items[]', () => {
    const out = flattenRelations({
      customer: { id: 'c1', notes: 'secret' },
      items: [{ resource: { id: 'r2' }, service: 's2' }],
      resource: { id: 'r1' },
      service: 's1',
    })
    expect(out).toEqual({ customer: 'c1', items: [{ resource: 'r2', service: 's2' }], resource: 'r1', service: 's1' })
  })
})

describe('plugin-time guards', () => {
  const base = (): Config => ({ collections: [{ slug: 'users', auth: true, fields: [] }], endpoints: [] }) as unknown as Config

  it('refuses a host collection that would shadow /api/reserve/*', () => {
    const cfg = base()
    ;(cfg.collections as unknown[]).push({ slug: 'reserve', fields: [] })
    expect(() => payloadReserve({})(cfg)).toThrow(/shadow/)
  })

  it('disabled: true locks non-staff writes on the plugin collections', async () => {
    const cfg = payloadReserve({ disabled: true })(base())
    const reservations = cfg.collections!.find((c) => c.slug === 'reservations')!
    const customerReq = { req: { user: { id: 'c1', collection: 'customers' } } } as never
    const staffReq = { req: { user: { id: 's1', collection: 'users' } } } as never
    expect(await (reservations.access!.create as (a: unknown) => unknown)(customerReq)).toBe(false)
    expect(await (reservations.access!.create as (a: unknown) => unknown)(staffReq)).toBe(true)
    expect(reservations.hooks).toBeUndefined()
    const customers = cfg.collections!.find((c) => c.slug === 'customers')!
    // Customers keep their self-scoped rules so login/profile still work.
    expect(await (customers.access!.update as (a: unknown) => unknown)(customerReq)).toEqual({ id: { equals: 'c1' } })
  })

  it('maxFlexibleDuration must be positive', () => {
    expect(() => payloadReserve({ maxFlexibleDuration: 0 })(base())).toThrow(/maxFlexibleDuration/)
  })
})

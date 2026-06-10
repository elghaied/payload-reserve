import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { createServicesCollection } from '../src/collections/Services.js'
import { resolveConfig } from '../src/defaults.js'
import { enforceCustomerOwnership } from '../src/hooks/reservations/enforceCustomerOwnership.js'
import { payloadReserve } from '../src/plugin.js'
import { composeAccess, makeResourceOwnerAccess } from '../src/utilities/ownerAccess.js'

const minimalConfig = (): Config =>
  ({ collections: [{ slug: 'users', auth: true, fields: [] }] }) as unknown as Config

describe('C9: composeAccess overlays overrides per operation', () => {
  it('keeps base ops the override does not specify', () => {
    const base = { create: () => false, delete: () => false, read: () => false, update: () => false }
    const readOnly = () => true
    const composed = composeAccess(base, { read: readOnly })
    expect(composed.read).toBe(readOnly)
    expect(composed.create).toBe(base.create)
    expect(composed.update).toBe(base.update)
    expect(composed.delete).toBe(base.delete)
  })

  it('tolerates an undefined override', () => {
    const base = { read: () => true }
    expect(composeAccess(base, undefined)).toEqual(base)
  })
})

describe('B4: owner-mode admin detection respects roleField', () => {
  const rom = {
    adminRoles: ['admin'],
    ownedServices: false,
    ownerField: 'owner',
    roleField: 'roles',
  }
  const access = makeResourceOwnerAccess(rom)

  it('treats a user with a matching role in a roles[] array as admin', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (access.read as any)({ req: { user: { id: 'u1', roles: ['admin'] } } })
    expect(result).toBe(true)
  })

  it('scopes a non-admin user to their own owned records', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (access.read as any)({ req: { user: { id: 'u1', roles: ['customer'] } } })
    expect(result).toEqual({ owner: { equals: 'u1' } })
  })
})

describe('C3/C6: resolveConfig validation', () => {
  it('does not throw for a disabled plugin with an invalid sub-config', () => {
    expect(() =>
      resolveConfig({ disabled: true, statusMachine: { statuses: ['only-one'] } }),
    ).not.toThrow()
  })

  it('still throws for an ENABLED plugin with an invalid status machine', () => {
    expect(() => resolveConfig({ statusMachine: { statuses: ['x'] } })).toThrow()
  })

  it('rejects a terminal status that has outgoing transitions (C6)', () => {
    expect(() =>
      resolveConfig({
        statusMachine: {
          blockingStatuses: ['open'],
          defaultStatus: 'open',
          statuses: ['open', 'done'],
          terminalStatuses: ['done'],
          transitions: { done: ['open'], open: ['done'] },
        },
      }),
    ).toThrow(/terminal status cannot have outgoing transitions/)
  })

  it('rejects a terminal defaultStatus (C6)', () => {
    expect(() =>
      resolveConfig({
        statusMachine: {
          blockingStatuses: [],
          defaultStatus: 'done',
          statuses: ['open', 'done'],
          terminalStatuses: ['done'],
          transitions: { open: ['done'] },
        },
      }),
    ).toThrow(/defaultStatus "done" cannot be a terminal status/)
  })
})

describe('C1: Services owner relationship targets the resolved owner collection', () => {
  it('points at ownerCollection, not a hardcoded customers slug', () => {
    const resolved = resolveConfig({
      resourceOwnerMode: { adminRoles: ['admin'], ownedServices: true, ownerCollection: 'staff' },
    })
    const services = createServicesCollection(resolved)
    const ownerField = services.fields.find(
      (f): f is { name: string } & Record<string, unknown> => 'name' in f && f.name === 'owner',
    )
    expect(ownerField?.relationTo).toBe('staff')
  })
})

describe('C2/C3/C11: plugin registration', () => {
  it('throws when userCollection does not exist (C2)', () => {
    expect(() => payloadReserve({ userCollection: 'nope' })(minimalConfig())).toThrow(
      /userCollection "nope" was not found/,
    )
  })

  it('throws on a slug collision with a clear message (C11)', () => {
    const config = minimalConfig()
    config.collections!.push({ slug: 'services', fields: [] })
    expect(() => payloadReserve({})(config)).toThrow(/slug "services" already exists/)
  })

  it('registers collections but strips hooks and endpoints when disabled (C3)', () => {
    const config = payloadReserve({ disabled: true })(minimalConfig())
    const slugs = config.collections!.map((c) => c.slug)
    expect(slugs).toContain('services')
    expect(slugs).toContain('reservations')
    expect(slugs).toContain('customers')
    const reservations = config.collections!.find((c) => c.slug === 'reservations')
    expect(reservations?.hooks).toBeUndefined()
    expect(config.endpoints ?? []).toHaveLength(0)
  })

  it('registers endpoints and reservation hooks when enabled', () => {
    const config = payloadReserve({})(minimalConfig())
    const reservations = config.collections!.find((c) => c.slug === 'reservations')
    expect(reservations?.hooks?.beforeChange?.length).toBeGreaterThan(0)
    expect((config.endpoints ?? []).length).toBeGreaterThan(0)
  })
})

describe('B3 parallel route: enforceCustomerOwnership', () => {
  const config = resolveConfig({})
  const hook = enforceCustomerOwnership(config)
  const run = (data: Record<string, unknown>, user: Record<string, unknown> | undefined) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hook({ data, operation: 'create', req: { user } } as any)

  it('forces a non-privileged customer to book for themselves', () => {
    const result = run({ customer: 'victim' }, { id: 'me', collection: 'customers' })
    expect((result as Record<string, unknown>).customer).toBe('me')
  })

  it('leaves a booking that already targets self', () => {
    const result = run({ customer: 'me' }, { id: 'me', collection: 'customers' })
    expect((result as Record<string, unknown>).customer).toBe('me')
  })

  it('does not touch guest bookings (no customer)', () => {
    const result = run({ guest: { name: 'Walk In' } }, { id: 'me', collection: 'customers' })
    expect((result as Record<string, unknown>).customer).toBeUndefined()
  })

  it('lets staff/admin book for anyone', () => {
    const result = run({ customer: 'someone' }, { id: 'admin', collection: 'users' })
    expect((result as Record<string, unknown>).customer).toBe('someone')
  })
})

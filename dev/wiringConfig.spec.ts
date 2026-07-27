import type { Config } from 'payload'

import { describe, expect, it, vi } from 'vitest'

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

describe('C7: configurable confirm/cancel statuses', () => {
  it('defaults confirmStatus/cancelStatus to confirmed/cancelled', () => {
    const sm = resolveConfig({}).statusMachine
    expect(sm.confirmStatus).toBe('confirmed')
    expect(sm.cancelStatus).toBe('cancelled')
  })

  it('accepts a custom vocabulary and validates membership', () => {
    const sm = resolveConfig({
      statusMachine: {
        blockingStatuses: ['booked'],
        cancelStatus: 'voided',
        confirmStatus: 'booked',
        defaultStatus: 'requested',
        statuses: ['requested', 'booked', 'done', 'voided'],
        terminalStatuses: ['done', 'voided'],
        transitions: {
          booked: ['done', 'voided'],
          done: [],
          requested: ['booked', 'voided'],
          voided: [],
        },
      },
    }).statusMachine
    expect(sm.confirmStatus).toBe('booked')
    expect(sm.cancelStatus).toBe('voided')
  })

  it('throws when confirmStatus is not a known status', () => {
    expect(() =>
      resolveConfig({ statusMachine: { confirmStatus: 'nope' } }),
    ).toThrow(/confirmStatus "nope" is not in statuses/)
  })

  it('throws when cancelStatus is not a known status', () => {
    expect(() =>
      resolveConfig({ statusMachine: { cancelStatus: 'nope' } }),
    ).toThrow(/cancelStatus "nope" is not in statuses/)
  })
})

describe('C8: image field gated on the media collection existing', () => {
  const withCollections = (extra: Array<{ slug: string }>): Config =>
    ({
      collections: [{ slug: 'users', auth: true, fields: [] }, ...extra],
    }) as unknown as Config

  const hasField = (config: Config, slug: string, name: string): boolean => {
    const c = config.collections!.find((x) => x.slug === slug)!
    return c.fields.some((f) => 'name' in f && f.name === name)
  }

  it('omits the image field when no media collection is present', () => {
    const config = payloadReserve({})(withCollections([]))
    expect(hasField(config, 'services', 'image')).toBe(false)
    expect(hasField(config, 'resources', 'image')).toBe(false)
  })

  it('adds the image field when a media collection exists', () => {
    const config = payloadReserve({})(withCollections([{ slug: 'media' }]))
    expect(hasField(config, 'services', 'image')).toBe(true)
    expect(hasField(config, 'resources', 'image')).toBe(true)
  })
})

describe('C4: userCollection field injection', () => {
  it('injects name as NOT required and dedups against nested fields', () => {
    const usersWithNestedName = {
      slug: 'users',
      auth: true,
      fields: [
        // name nested inside a row — must be detected and not re-injected
        { type: 'row', fields: [{ name: 'name', type: 'text' }] },
      ],
    }
    const config = payloadReserve({ userCollection: 'users' })({
      collections: [usersWithNestedName],
    } as unknown as Config)
    const users = config.collections!.find((c) => c.slug === 'users')!
    // top-level `name` not duplicated (it lives in the row)
    const topLevelNames = users.fields.filter((f) => 'name' in f && f.name === 'name')
    expect(topLevelNames).toHaveLength(0)
    // phone/notes/bookings still injected at top level
    expect(users.fields.some((f) => 'name' in f && f.name === 'phone')).toBe(true)
  })

  it('injects an optional name on a plain users collection', () => {
    const config = payloadReserve({ userCollection: 'users' })({
      collections: [{ slug: 'users', auth: true, fields: [] }],
    } as unknown as Config)
    const users = config.collections!.find((c) => c.slug === 'users')!
    const nameField = users.fields.find((f) => 'name' in f && f.name === 'name') as
      | Record<string, unknown>
      | undefined
    expect(nameField).toBeDefined()
    expect(nameField!.required).toBeUndefined()
  })
})

describe('C7: cancel endpoint uses the configured cancelStatus', () => {
  it('writes statusMachine.cancelStatus, not a hardcoded "cancelled"', async () => {
    const { createCancelBookingEndpoint } = await import('../src/endpoints/cancelBooking.js')
    const config = resolveConfig({
      statusMachine: {
        blockingStatuses: ['booked'],
        cancelStatus: 'voided',
        confirmStatus: 'booked',
        defaultStatus: 'requested',
        statuses: ['requested', 'booked', 'done', 'voided'],
        terminalStatuses: ['done', 'voided'],
        transitions: {
          booked: ['done', 'voided'],
          done: [],
          requested: ['booked', 'voided'],
          voided: [],
        },
      },
    })
    const ep = createCancelBookingEndpoint(config)
    let written: Record<string, unknown> | undefined
    const req = {
      json: () => Promise.resolve({ reservationId: 'r1' }),
      payload: {
        findByID: () => Promise.resolve({ id: 'r1', customer: 'cust-1' }),
        update: (args: { data: Record<string, unknown> }) => {
          written = args.data
          return Promise.resolve({ id: 'r1', ...args.data })
        },
      },
      user: { id: 'cust-1', collection: 'customers' },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await ep.handler(req as any)
    expect(resp.status).toBe(200)
    expect(written?.status).toBe('voided')
  })
})

describe('enforceActive config option', () => {
  it('enforceActive defaults to true', () => {
    expect(resolveConfig({}).enforceActive).toBe(true)
  })

  it('enforceActive can be turned off', () => {
    expect(resolveConfig({ enforceActive: false }).enforceActive).toBe(false)
  })
})

describe('locale completeness', () => {
  it('every locale defines the same keys as en', async () => {
    const { translations } = await import('../src/translations/index.js')
    const enKeys = Object.keys(
      (translations.en as { reservation: Record<string, unknown> }).reservation,
    ).sort()
    for (const [locale, bundle] of Object.entries(translations)) {
      const keys = Object.keys(
        (bundle as { reservation: Record<string, unknown> }).reservation,
      ).sort()
      expect(keys, `locale ${locale} is missing keys`).toEqual(enKeys)
    }
  })
})

describe('resources join gate warns at init', () => {
  const dropServicesField = () =>
    payloadReserve({
      collectionOverrides: {
        resources: {
          fields: ({ defaultFields }) =>
            defaultFields.filter((f) => !('name' in f && f.name === 'services')),
        },
      },
    })

  it('warns when resources.services was overridden away', async () => {
    const config = dropServicesField()(minimalConfig())
    const warn = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await config.onInit!({ logger: { warn } } as any)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/join was skipped/i))
  })

  it('awaits the host onInit before warning', async () => {
    const calls: string[] = []
    const hostConfig = minimalConfig()
    // eslint-disable-next-line @typescript-eslint/require-await
    hostConfig.onInit = async () => {
      calls.push('host')
    }
    const config = dropServicesField()(hostConfig)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await config.onInit!({ logger: { warn: () => calls.push('warn') } } as any)
    expect(calls).toEqual(['host', 'warn'])
  })

  it('does not break init when the logger throws', async () => {
    const calls: string[] = []
    const hostConfig = minimalConfig()
    // eslint-disable-next-line @typescript-eslint/require-await
    hostConfig.onInit = async () => {
      calls.push('host')
    }
    const config = dropServicesField()(hostConfig)
    await expect(
      config.onInit!({
        logger: {
          warn: () => {
            throw new Error('logger exploded')
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).resolves.toBeUndefined()
    expect(calls).toEqual(['host'])
  })

  it('leaves onInit alone when the field is present', () => {
    expect(payloadReserve({})(minimalConfig()).onInit).toBeUndefined()
  })
})

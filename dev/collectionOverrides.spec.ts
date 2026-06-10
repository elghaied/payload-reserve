import type { CollectionConfig, Config } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { payloadReserve } from '../src/plugin.js'
import { applyCollectionOverride } from '../src/utilities/collectionOverrides.js'

const baseCollection = (): CollectionConfig => ({
  slug: 'services',
  access: { create: () => false, read: () => true, update: () => false },
  fields: [{ name: 'name', type: 'text' }],
  hooks: { beforeChange: [() => undefined] },
})

describe('applyCollectionOverride', () => {
  it('returns the collection unchanged when no override is given', () => {
    const c = baseCollection()
    expect(applyCollectionOverride(c)).toBe(c)
  })

  it('passes the default fields to the fields function and uses its result', () => {
    const joinField = { name: 'referencedResources', type: 'join' } as never
    const result = applyCollectionOverride(baseCollection(), {
      fields: ({ defaultFields }) => [...defaultFields, joinField],
    })
    const names = result.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(names).toEqual(['name', 'referencedResources'])
  })

  it('merges hooks — plugin hooks run first, override hooks appended', () => {
    const pluginHook = baseCollection().hooks!.beforeChange![0]
    const userHook = () => undefined
    const result = applyCollectionOverride(baseCollection(), {
      hooks: { afterChange: [userHook], beforeChange: [userHook] },
    })
    expect(result.hooks?.beforeChange).toHaveLength(2)
    expect(result.hooks?.beforeChange?.[1]).toBe(userHook)
    // a brand-new event array the plugin didn't have is added
    expect(result.hooks?.afterChange).toEqual([userHook])
    // plugin's original first hook is preserved at index 0
    expect(typeof result.hooks?.beforeChange?.[0]).toBe(typeof pluginHook)
  })

  it('composes access per operation — unmentioned ops survive', () => {
    const openRead = () => true
    const result = applyCollectionOverride(baseCollection(), { access: { read: openRead } })
    expect(result.access?.read).toBe(openRead)
    // create/update were not in the override — the plugin's rules survive
    expect(typeof result.access?.create).toBe('function')
    expect(typeof result.access?.update).toBe('function')
  })

  it('shallow-merges other keys (admin/labels) and ignores slug', () => {
    const result = applyCollectionOverride(baseCollection(), {
      slug: 'hijacked' as never,
      admin: { group: 'Bookings' },
    })
    expect(result.slug).toBe('services')
    expect(result.admin?.group).toBe('Bookings')
  })
})

describe('collectionOverrides wired through payloadReserve', () => {
  const minimalConfig = (): Config =>
    ({ collections: [{ slug: 'users', auth: true, fields: [] }] }) as unknown as Config

  it('applies the issue #4 join field to Services while keeping core fields and hooks', () => {
    const joinField = {
      name: 'referencedResources',
      type: 'join',
      collection: 'resources',
      on: 'services',
    } as never
    const config = payloadReserve({
      collectionOverrides: {
        services: { fields: ({ defaultFields }) => [...defaultFields, joinField] },
      },
    })(minimalConfig())

    const services = config.collections!.find((c) => c.slug === 'services')!
    const names = services.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(names).toContain('referencedResources')
    expect(names).toContain('name') // core field still present
  })

  it('a custom reservations hook runs alongside the plugin hooks', () => {
    const userHook = vi.fn(({ data }: { data: unknown }) => data)
    const config = payloadReserve({
      collectionOverrides: { reservations: { hooks: { beforeChange: [userHook as never] } } },
    })(minimalConfig())

    const reservations = config.collections!.find((c) => c.slug === 'reservations')!
    // plugin registers several beforeChange hooks; the user's is appended after them
    expect(reservations.hooks!.beforeChange!.length).toBeGreaterThan(1)
    expect(reservations.hooks!.beforeChange!.at(-1)).toBe(userHook)
  })
})

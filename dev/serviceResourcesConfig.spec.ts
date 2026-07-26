import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/plugin.js'

const minimalConfig = (): Config =>
  ({ collections: [{ slug: 'users', auth: true, fields: [] }] }) as unknown as Config

describe('Services.resources join — config only', () => {
  it('respects a custom slugs.resources', () => {
    const config = payloadReserve({ slugs: { resources: 'assets' } })(minimalConfig())
    const services = config.collections!.find((c) => c.slug === 'services')!
    const join = services.fields.find((f) => 'name' in f && f.name === 'resources')!
    expect((join as { collection: string }).collection).toBe('assets')
  })

  it('omits the join when an override removes the target field', () => {
    const config = payloadReserve({
      collectionOverrides: {
        resources: {
          fields: ({ defaultFields }) =>
            defaultFields.filter((f) => !('name' in f) || f.name !== 'services'),
        },
      },
    })(minimalConfig())

    const services = config.collections!.find((c) => c.slug === 'services')!
    const names = services.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(names).not.toContain('resources') // skipped, not crashed
    expect(names).toContain('name') // the rest of the collection is intact
  })

  it('omits the join when an override nests the target in a named tab', () => {
    // The likelier case: a consumer tidying the admin UI, not deleting anything.
    // flattenAllFields keeps NAMED tabs as containers, so `on: 'services'` would
    // no longer resolve and sanitizeJoinField would throw at init.
    const config = payloadReserve({
      collectionOverrides: {
        resources: {
          fields: ({ defaultFields }) => [
            {
              type: 'tabs',
              tabs: [
                { name: 'links', fields: defaultFields.filter((f) => 'name' in f && f.name === 'services') },
              ],
            } as never,
            ...defaultFields.filter((f) => !('name' in f) || f.name !== 'services'),
          ],
        },
      },
    })(minimalConfig())

    const services = config.collections!.find((c) => c.slug === 'services')!
    const names = services.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(names).not.toContain('resources')
  })

  it('includes the join for a default install', () => {
    const config = payloadReserve({})(minimalConfig())
    const services = config.collections!.find((c) => c.slug === 'services')!
    const names = services.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(names).toContain('resources') // guard: the skip is conditional, not always-on
  })
})

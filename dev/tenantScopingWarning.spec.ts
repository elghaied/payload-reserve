import type { Config, Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'

type Warned = { messages: string[]; payload: Payload }

function fakePayload(collections: Array<Record<string, unknown>>, throwOnWarn = false): Warned {
  const messages: string[] = []
  const payload = {
    config: { collections },
    logger: {
      warn: (msg: string) => {
        if (throwOnWarn) {
          throw new Error('logger exploded')
        }
        messages.push(msg)
      },
    },
  } as unknown as Payload
  return { messages, payload }
}

const baseConfig = (): Config =>
  ({ collections: [], endpoints: [] }) as unknown as Config

async function runInit(
  scopedCollections: Array<Record<string, unknown>>,
  throwOnWarn = false,
): Promise<string[]> {
  const config = payloadReserve({})(baseConfig())
  const generated = (config.collections ?? []) as Array<Record<string, unknown>>
  const { messages, payload } = fakePayload([...generated, ...scopedCollections], throwOnWarn)
  await config.onInit?.(payload)
  return messages
}

const scopedPosts = {
  slug: 'posts',
  fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
}

const tenantField = { name: 'tenant', type: 'relationship', relationTo: 'tenants' }

/** The `tenants` array multi-tenant pushes onto the admin users collection. */
const usersWithTenantsArray = {
  slug: 'users',
  auth: true,
  fields: [
    {
      name: 'tenants',
      type: 'array',
      fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
    },
  ],
}

const scopeAllBut = (
  generated: Array<Record<string, unknown>>,
  exceptSlug: null | string,
): void => {
  for (const c of generated) {
    if (c.slug !== exceptSlug) {
      ;(c.fields as Array<Record<string, unknown>>).push({ ...tenantField })
    }
  }
}

describe('tenant-scoping diagnostic (D2)', () => {
  it('warns when another collection is tenant-scoped but reservations is not', async () => {
    const messages = await runInit([scopedPosts])
    expect(messages.join('\n')).toMatch(/not tenant-scoped/i)
    expect(messages.join('\n')).toMatch(/reservations/)
  })

  it('stays silent when no collection is tenant-scoped', async () => {
    const messages = await runInit([{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }])
    expect(messages).toEqual([])
  })

  it('stays silent when the plugin collections ARE tenant-scoped', async () => {
    const config = payloadReserve({})(baseConfig())
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    // Simulate multi-tenant having injected the tenant field into reservations.
    for (const c of generated) {
      ;(c.fields as Array<Record<string, unknown>>).push({
        name: 'tenant',
        type: 'relationship',
        relationTo: 'tenants',
      })
    }
    const { messages, payload } = fakePayload([...generated, scopedPosts])
    await config.onInit?.(payload)
    expect(messages).toEqual([])
  })

  it('does not break boot when the host logger throws', async () => {
    await expect(runInit([scopedPosts], true)).resolves.toEqual([])
  })

  // In standalone mode `customers` is a plugin-generated AUTH collection holding
  // the PII the access work exists to protect. Leaving it out of multi-tenant's
  // own `collections` option makes customer-search leak every tenant's customers
  // — the exact configuration this diagnostic was added to catch.
  it('names customers when it alone is unscoped in standalone mode', async () => {
    const config = payloadReserve({})(baseConfig())
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    scopeAllBut(generated, 'customers')
    const { messages, payload } = fakePayload([...generated, scopedPosts])
    await config.onInit?.(payload)
    const joined = messages.join('\n')
    expect(joined).toMatch(/not tenant-scoped/i)
    expect(joined).toMatch(/customers/)
  })

  // In userCollection mode the customer collection IS the host's auth
  // collection, which multi-tenant scopes with a `tenants` ARRAY rather than a
  // flat `tenant` field — so a flat-field check would false-positive on it.
  it('does not flag the user collection in userCollection mode', async () => {
    const config = payloadReserve({ userCollection: 'users' })({
      collections: [usersWithTenantsArray],
      endpoints: [],
    } as unknown as Config)
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    for (const c of generated) {
      if (c.slug !== 'users') {
        ;(c.fields as Array<Record<string, unknown>>).push({ ...tenantField })
      }
    }
    const { messages, payload } = fakePayload([...generated, scopedPosts])
    await config.onInit?.(payload)
    expect(messages).toEqual([])
  })

  // A consumer who scopes ONLY the reservation collections and forgets them all
  // leaves no other collection carrying a flat tenant field, so the "some other
  // collection is scoped" signal never fires. The tenants array multi-tenant
  // pushes onto the admin users collection is the second signal.
  it('warns off the users tenants array when no collection carries a flat tenant field', async () => {
    const messages = await runInit([usersWithTenantsArray])
    expect(messages.join('\n')).toMatch(/not tenant-scoped/i)
    expect(messages.join('\n')).toMatch(/reservations/)
  })

  it('stays silent when the users tenants array is present but everything is scoped', async () => {
    const config = payloadReserve({})(baseConfig())
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    scopeAllBut(generated, null)
    const { messages, payload } = fakePayload([...generated, usersWithTenantsArray])
    await config.onInit?.(payload)
    expect(messages).toEqual([])
  })
})

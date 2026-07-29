import type { Config, Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'

type Warned = { messages: string[]; payload: Payload }

function fakePayload(collections: Array<Record<string, unknown>>, throwOnWarn = false): Warned {
  const messages: string[] = []
  const payload = {
    // A transactional stub so this file's tenant-scoping assertions aren't
    // polluted by the unrelated no-transactions diagnostic (see
    // transactionSupport.spec.ts for that check in isolation).
    config: { collections },
    // eslint-disable-next-line @typescript-eslint/require-await
    db: { beginTransaction: async () => 'txn-1' },
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

/** A userCollection auth collection carrying neither signal multi-tenant uses. */
const usersWithNoTenantSignal = {
  slug: 'users',
  auth: true,
  fields: [{ name: 'email', type: 'email' }],
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

  it('stays silent on the unscoped-collections check when the plugin collections ARE tenant-scoped', async () => {
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
    // Scoping every collection fixes THIS check, but not the separate
    // standalone-mode probe-precondition warning below (D3) — this is still
    // standalone mode (`payloadReserve({})`), so that one still fires.
    expect(messages.join('\n')).not.toMatch(/not tenant-scoped/i)
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

  it('stays silent on the unscoped-collections check when the users tenants array is present but everything is scoped', async () => {
    const config = payloadReserve({})(baseConfig())
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    scopeAllBut(generated, null)
    const { messages, payload } = fakePayload([...generated, usersWithTenantsArray])
    await config.onInit?.(payload)
    // Same distinction as above: this is still standalone mode, so D3 fires
    // even though nothing is left unscoped.
    expect(messages.join('\n')).not.toMatch(/not tenant-scoped/i)
  })
})

describe('tenant-membership-probe precondition diagnostic (D3)', () => {
  // createBooking's tenant-membership probe (callerMayUseTenant) is only a
  // real membership check when the caller authenticates against the SAME
  // collection multi-tenant wraps. In standalone mode that's never true for a
  // customer (they authenticate against the plugin's own `customers`
  // collection) — this warns about exactly that configuration, independent of
  // whether any particular collection happens to be scoped.
  it('warns in standalone mode once multi-tenant is detected', async () => {
    const messages = await runInit([scopedPosts])
    const joined = messages.join('\n')
    expect(joined).toMatch(/tenant-membership check/i)
    expect(joined).toMatch(/standalone mode/i)
  })

  it('stays silent when multi-tenant is not detected at all', async () => {
    const messages = await runInit([{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }])
    expect(messages.join('\n')).not.toMatch(/tenant-membership check/i)
  })

  it('does not fire in userCollection mode', async () => {
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
    expect(messages.join('\n')).not.toMatch(/tenant-membership check/i)
  })
})

describe('userCollection auth-collection blind-spot diagnostic (D4)', () => {
  // The D2 unscoped-collections check deliberately excludes `customers` from its
  // candidates in userCollection mode — that slug is the host's own auth
  // collection, scoped via multi-tenant's `tenants` ARRAY rather than a flat
  // field, so a flat-field check would always false-positive on it. That leaves
  // a real blind spot: an auth collection with NEITHER the array NOR the flat
  // field is genuinely unscoped and got no signal at all before this diagnostic.
  it('warns when the userCollection auth collection has neither the tenants array nor a flat tenant field', async () => {
    const config = payloadReserve({ userCollection: 'users' })({
      collections: [usersWithNoTenantSignal],
      endpoints: [],
    } as unknown as Config)
    const generated = (config.collections ?? []) as Array<Record<string, unknown>>
    // Scope every OTHER generated collection so multi-tenant is detected (D2's
    // gate) — 'users' is deliberately left without a tenant field or array.
    for (const c of generated) {
      if (c.slug !== 'users') {
        ;(c.fields as Array<Record<string, unknown>>).push({ ...tenantField })
      }
    }
    const { messages, payload } = fakePayload(generated)
    await config.onInit?.(payload)
    const joined = messages.join('\n')
    expect(joined).toMatch(/neither/i)
    expect(joined).toMatch(/users/)
  })

  it('stays silent when the userCollection auth collection carries the tenants array', async () => {
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
    const { messages, payload } = fakePayload(generated)
    await config.onInit?.(payload)
    expect(messages.join('\n')).not.toMatch(/neither/i)
  })
})

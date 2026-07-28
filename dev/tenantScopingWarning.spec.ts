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
})

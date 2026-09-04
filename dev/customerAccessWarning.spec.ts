import type { Config, Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'

/**
 * D6: userCollection mode keeps Payload's default access on Reservations (the
 * plugin cannot tell staff from customers there without roles), so the boot
 * diagnostic has to say so whenever nothing narrows `read`. Standalone mode
 * ships scoped defaults and must stay silent.
 */

function fakePayload(collections: Array<Record<string, unknown>>) {
  const messages: string[] = []
  const payload = {
    config: { collections },
    // eslint-disable-next-line @typescript-eslint/require-await
    db: { beginTransaction: async () => 'txn-1' },
    logger: {
      warn: (msg: string) => {
        messages.push(msg)
      },
    },
  } as unknown as Payload
  return { messages, payload }
}

const users = { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }] }
const baseConfig = (): Config =>
  ({ collections: [users], endpoints: [] }) as unknown as Config

const D6 = /"access.reservations" rule narrows reads/

async function warningsFor(options: Parameters<typeof payloadReserve>[0]) {
  const config = payloadReserve(options)(baseConfig())
  const { messages, payload } = fakePayload(
    (config.collections ?? []) as unknown as Array<Record<string, unknown>>,
  )
  await config.onInit!(payload)
  return messages.join('\n')
}

describe('D6: customers can read every reservation in userCollection mode', () => {
  it('warns when userCollection is set and nothing narrows access.reservations.read', async () => {
    expect(await warningsFor({ userCollection: 'users' })).toMatch(D6)
  })

  it('stays silent when the host supplies access.reservations.read', async () => {
    expect(
      await warningsFor({
        access: { reservations: { read: () => true } },
        userCollection: 'users',
      }),
    ).not.toMatch(D6)
  })

  it('stays silent under resourceOwnerMode, which brings its own rules', async () => {
    expect(
      await warningsFor({ resourceOwnerMode: { adminRoles: ['admin'] }, userCollection: 'users' }),
    ).not.toMatch(D6)
  })

  it('stays silent in standalone mode, which ships scoped defaults', async () => {
    expect(await warningsFor({})).not.toMatch(D6)
  })
})

describe('D6b/D7: catalog writes and anonymous create', () => {
  it('warns when userCollection leaves services/resources/schedules writable by every user', async () => {
    const msgs = await warningsFor({ userCollection: 'users' })
    expect(msgs).toMatch(/services, resources, schedules have no create\/update\/delete rule/)
  })

  it('stays silent once the catalog writes are restricted', async () => {
    const staffOnly = { create: () => false, delete: () => false, update: () => false }
    const msgs = await warningsFor({
      access: { reservations: { read: () => true }, resources: staffOnly, schedules: staffOnly, services: staffOnly },
      userCollection: 'users',
    })
    expect(msgs).not.toMatch(/have no create\/update\/delete rule/)
  })

  it('warns when access.reservations.create admits anonymous callers', async () => {
    expect(await warningsFor({ access: { reservations: { create: () => true } } })).toMatch(/allows anonymous callers/)
    expect(await warningsFor({ access: { reservations: { create: ({ req }) => Boolean(req.user) } } })).not.toMatch(/allows anonymous callers/)
  })
})

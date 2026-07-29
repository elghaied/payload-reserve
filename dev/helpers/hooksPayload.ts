import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import type { ReservationPluginHooks } from '../../src/types.js'

import { testDbUri } from './testDbUri.js'
import { testEmailAdapter } from './testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Mutable counters the counting hooks write into; reset between tests. */
export const hookCalls = {
  afterBookingCreate: 0,
  afterStatusChange: [] as Array<{ newStatus: string; previousStatus: string }>,
  beforeBookingCancel: 0,
  beforeBookingCreate: 0,
}

export function resetHookCalls(): void {
  hookCalls.afterBookingCreate = 0
  hookCalls.afterStatusChange = []
  hookCalls.beforeBookingCancel = 0
  hookCalls.beforeBookingCreate = 0
}

/** Plugin hooks that only count invocations — shared by the booted instance
 * and any endpoint factory built in tests, so both layers hit the same counters. */
export const countingHooks: ReservationPluginHooks = {
  afterBookingCreate: [
    () => {
      hookCalls.afterBookingCreate++
    },
  ],
  afterStatusChange: [
    ({ newStatus, previousStatus }) => {
      hookCalls.afterStatusChange.push({ newStatus, previousStatus })
    },
  ],
  beforeBookingCancel: [
    () => {
      hookCalls.beforeBookingCancel++
    },
  ],
  beforeBookingCreate: [
    ({ data }) => {
      hookCalls.beforeBookingCreate++
      return data
    },
  ],
}

/** Boots a Payload instance with payloadReserve configured with counting hooks. */
export async function buildHooksPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const db = await testDbUri('hooksmemory')

  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') } },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [],
      },
      {
        slug: 'media',
        fields: [],
        upload: { staticDir: path.resolve(dirname, '..', 'media') },
      },
    ],
    db: mongooseAdapter({ ensureIndexes: true, url: db.uri }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [payloadReserve({ hooks: countingHooks })],
    secret: 'hooks-test-secret',
    sharp,
    typescript: {
      autoGenerate: false,
    },
  })

  const payload = await getPayload({ config })

  return {
    payload,
    stop: async () => {
      await payload.destroy()
      await db.stop()
    },
  }
}

import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testDbUri } from './testDbUri.js'
import { testEmailAdapter } from './testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Boots a plain Payload instance with default payloadReserve() — no multi-tenant,
 * no dev-app seed data — dedicated so `getAvailableSlots`'s EmptyReason tests can
 * set up inactive services/resources without colliding with other spec files'
 * cached Payload instances. */
export async function buildAvailabilityReasonPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const db = await testDbUri('availabilityreasonmemory')

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
    plugins: [payloadReserve({})],
    secret: 'availability-reason-test-secret',
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

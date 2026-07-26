import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Boots a plain Payload instance with default payloadReserve() — no multi-tenant,
 * no dev-app seed data — for testing the Services.resources join in isolation. */
export async function buildServiceResourcesPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const memoryDB = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: 'serviceresourcesmemory' },
  })

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
    db: mongooseAdapter({ ensureIndexes: true, url: `${memoryDB.getUri()}&retryWrites=true` }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [payloadReserve({})],
    secret: 'service-resources-test-secret',
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
      await memoryDB.stop()
    },
  }
}

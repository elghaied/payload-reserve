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

/**
 * Boots payloadReserve with `resourceOwnerMode` enabled — used to exercise
 * owner-scoped access control on the Services.resources join. `users` carries
 * a plain `role` field (not injected by the plugin) so fixtures can mark a
 * user 'admin' vs a plain staff owner without pulling in staffProvisioning.
 */
export async function buildServiceResourcesAccessPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const memoryDB = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: 'sraccessmemory' },
  })

  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') } },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [{ name: 'role', type: 'text' }],
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
    plugins: [
      payloadReserve({
        resourceOwnerMode: { adminRoles: ['admin'], ownerCollection: 'users', roleField: 'role' },
      }),
    ],
    secret: 'service-resources-access-test-secret',
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

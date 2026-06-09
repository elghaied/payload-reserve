import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Boots a Payload instance with payloadReserve + the real multi-tenant plugin. */
export async function buildMultiTenantPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const memoryDB = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: 'mtmemory' } })

  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') } },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          { name: 'superAdmin', type: 'checkbox' },
          {
            name: 'tenants',
            type: 'array',
            fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
          },
        ],
      },
      {
        slug: 'tenants',
        admin: { useAsTitle: 'name' },
        fields: [{ name: 'name', type: 'text', required: true }],
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
    // payloadReserve MUST run before multiTenantPlugin so the reservations/resources
    // collections exist when multi-tenant injects the `tenant` field.
    plugins: [
      payloadReserve({ userCollection: 'users' }),
      multiTenantPlugin({
        collections: { reservations: {}, resources: {}, schedules: {}, services: {} },
        tenantsArrayField: { includeDefaultField: false },
        userHasAccessToAllTenants: (user) =>
          Boolean((user as { superAdmin?: boolean })?.superAdmin),
      }),
    ],
    secret: 'mt-test-secret',
    sharp,
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

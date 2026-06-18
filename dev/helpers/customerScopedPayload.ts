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

/**
 * Boots payloadReserve in standalone-customers mode with the real multi-tenant
 * plugin scoping the `customers` collection — so customers carry a `tenant`
 * field. Used to exercise tenant-scoped customer search (E1).
 */
export async function buildCustomerScopedPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
  const memoryDB = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: 'csmemory' } })

  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') }, user: 'users' },
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
    // payloadReserve MUST run before multiTenantPlugin so `customers` exists
    // when multi-tenant injects the `tenant` field. Empty options → standalone
    // Customers collection (no userCollection).
    plugins: [
      payloadReserve({}),
      multiTenantPlugin({
        collections: {
          customers: {},
          reservations: {},
          resources: {},
          schedules: {},
          services: {},
        },
        tenantsArrayField: { includeDefaultField: false },
        userHasAccessToAllTenants: (user) =>
          Boolean((user as { superAdmin?: boolean })?.superAdmin),
      }),
    ],
    secret: 'cs-test-secret',
    sharp,
    typescript: { autoGenerate: false },
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

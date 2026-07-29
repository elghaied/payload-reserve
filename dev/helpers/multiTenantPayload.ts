import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testDbUri } from './testDbUri.js'
import { testEmailAdapter } from './testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Boots a Payload instance with payloadReserve + the real multi-tenant plugin. */
export async function buildMultiTenantPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
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
        fields: [
          { name: 'name', type: 'text', required: true },
          // Per-tenant IANA timezone — exercised by the per-tenant timezone tests.
          { name: 'timezone', type: 'text' },
        ],
      },
      {
        slug: 'media',
        fields: [],
        upload: { staticDir: path.resolve(dirname, '..', 'media') },
      },
    ],
    db: mongooseAdapter({ ensureIndexes: true, url: await testDbUri('mtmemory') }),
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
    typescript: {
      autoGenerate: false,
    },
  })

  const payload = await getPayload({ config })
  return {
    payload,
    stop: async () => {
      await payload.destroy()
    },
  }
}

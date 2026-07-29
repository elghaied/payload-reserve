import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
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
  // Opt-in SQL harnesses, mirroring dev/payload.config.ts: `PG_URL=...` or
  // `SQLITE=1` runs this same multi-tenant fixture against a real SQL adapter
  // instead of the in-memory Mongo replica set. This exists to verify
  // callerMayUseTenant's tenant-membership probe (src/utilities/tenantTimezone.ts)
  // against NUMBER-shaped ids — the shape Postgres/SQLite use for a relationship,
  // which Mongo's ObjectId-string ids never produce. Skip testDbUri entirely in
  // that case: dev/globalSetup.ts does not start Mongo under either env var, so
  // calling it would spin up an unwanted private Mongo replica set instead of
  // reading MEMORY_DB_URI.
  const usingSqlAdapter = Boolean(process.env.PG_URL || process.env.SQLITE)
  const db = usingSqlAdapter ? null : await testDbUri('mtmemory')

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
    db: process.env.PG_URL
      ? postgresAdapter({
          pool: { connectionString: process.env.PG_URL },
          push: true,
          // Isolates this fixture's tables from the main suite's, which by the time
          // this file runs has already populated the SAME `PG_URL` database with
          // ~35 other files' worth of collections under the default `public` schema.
          // Without this, `push: true` schema-diffs an overlapping-but-different
          // shape (a different users/media collection, a new tenants collection,
          // multi-tenant-wrapped reservations/resources/schedules/services) onto
          // those already-populated tables and can take 60+ seconds — measured
          // hanging past vitest's hookTimeout entirely. A dedicated Postgres schema
          // gives this fixture its own empty namespace every time regardless of
          // what else has run in the same database; `push: true` creates it
          // automatically. Confirmed empirically: schema push against an
          // already-populated database dropped from 60s+ (timeout) to <1s with
          // this option set.
          schemaName: 'reserve_multi_tenant_test',
        })
      : process.env.SQLITE
        ? sqliteAdapter({
            client: { url: process.env.SQLITE_URL || 'file::memory:?cache=shared' },
            push: true,
            // See dev/payload.config.ts's identical option for why this is
            // required: without it db-sqlite's beginTransaction is a no-op.
            transactionOptions: {},
          })
        : mongooseAdapter({ ensureIndexes: true, url: db!.uri }),
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
      await db?.stop()
    },
  }
}

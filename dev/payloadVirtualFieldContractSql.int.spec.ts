/**
 * Relational half of the virtual-field contract (see
 * `payloadVirtualFieldContract.int.spec.ts` for the MongoDB half).
 *
 * This exists because the Mongo result for "virtual values are not persisted"
 * is not by itself proof: Mongoose schemas are strict and silently drop paths
 * they don't know about, which would produce a passing test even if Payload
 * did nothing. Relational adapters have no such forgiveness — drizzle builds an
 * explicit schema, so if a virtual `hasMany` relationship leaked through, it
 * would materialise as a real `svc_rels` table.
 *
 * SQLite is a valid stand-in for Postgres *for this question* because both
 * dialects share `@payloadcms/drizzle`'s `schema/traverseFields.js`, where the
 * `fieldIsVirtual(field) → return` guard sits at the top of the field loop,
 * ahead of the `case 'relationship'` branch.
 *
 * Asserting on the generated schema rather than on a row is deliberate: the
 * claim being defended is "no column, therefore no migration for existing
 * installs", and the schema is where that claim actually lives.
 */
import type { Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

let payload: Payload

beforeAll(async () => {
  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') } },
    collections: [
      {
        slug: 'svc',
        fields: [
          { name: 'name', type: 'text' },
          {
            name: 'resources',
            type: 'relationship',
            admin: { readOnly: false },
            hasMany: true,
            relationTo: 'res',
            virtual: true,
          },
        ],
      },
      {
        slug: 'res',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'svcs', type: 'relationship', hasMany: true, relationTo: 'svc' },
        ],
      },
    ],
    db: sqliteAdapter({ client: { url: ':memory:' }, push: true }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    secret: 'contract-sql-secret',
    sharp,
    typescript: { outputFile: path.resolve(dirname, 'contract-sql-types.ts') },
  })

  payload = await getPayload({ config })
})

afterAll(async () => {
  await payload?.destroy()
})

describe('virtual relationship field contract — sqlite (drizzle, shared with postgres)', () => {
  it('creates no column on the owning table for the virtual field', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables = (payload.db as any).tables as Record<string, Record<string, unknown>>
    const svcColumns = Object.keys(tables.svc ?? {})
    // eslint-disable-next-line no-console
    console.log('svc columns:', svcColumns)

    expect(svcColumns.length).toBeGreaterThan(0) // guard: the table really was built
    expect(svcColumns).not.toContain('resources')
    expect(svcColumns).not.toContain('resources_id')
  })

  it('creates no relationships table for the virtual hasMany field', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables = (payload.db as any).tables as Record<string, unknown>
    // eslint-disable-next-line no-console
    console.log('all tables:', Object.keys(tables))

    // `res` owns a real hasMany relationship, so res_rels MUST exist — that
    // proves the assertion below is meaningful and not vacuously true.
    expect(Object.keys(tables)).toContain('res_rels')
    // `svc`'s only relationship is the virtual one, so it must have no rels table.
    expect(Object.keys(tables)).not.toContain('svc_rels')
  })

  it('round-trips a write without persisting the virtual value', async () => {
    const r1 = await payload.create({ collection: 'res', data: { name: 'R1' } })
    const svc = await payload.create({
      collection: 'svc',
      data: { name: 'Haircut', resources: [r1.id] },
    })

    const reread = await payload.findByID({ collection: 'svc', depth: 0, id: svc.id })
    expect(reread.name).toBe('Haircut')
    // No afterRead hook on this config, so nothing should surface the value.
    expect(reread.resources).toBeUndefined()
  })
})

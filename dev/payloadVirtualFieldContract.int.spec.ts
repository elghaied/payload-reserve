/**
 * Pins the Payload framework behaviours that a writable virtual relationship
 * field depends on, so a future Payload upgrade fails here — loudly and
 * specifically — rather than silently breaking the Services edit surface.
 *
 * Uses synthetic collections on purpose: this asserts framework contract, not
 * plugin logic.
 *
 *  Q1 the submitted virtual value reaches collection `afterChange` as `data`
 *  Q2 ...on update too
 *  Q3 it is excluded from persistence (NO column / NO stored value)
 *  Q4 a field-level `afterRead` hook populates it on read
 *  Q5 `select` skips that `afterRead` hook (the N+1 escape hatch)
 *
 * Q3 is adapter-specific. This file covers MongoDB, where a passing result
 * could in principle be a Mongoose strict-mode artifact rather than a Payload
 * guarantee — so the relational path is proven separately in
 * `payloadVirtualFieldContractSql.int.spec.ts`. Both must pass.
 */
import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

type Harness = {
  /** Reads the persisted row/doc straight from the adapter, bypassing Payload. */
  rawKeys: (payload: Payload, name: string) => Promise<string[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup: () => Promise<{ db: any; teardown: () => Promise<void> }>
}

const harnesses: Array<[string, Harness]> = [
  [
    'mongodb',
    {
      rawKeys: async (payload, name) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (payload.db as any).collections.svc.findOne({ name }).lean()
        return Object.keys(raw ?? {})
      },
      setup: async () => {
        const memoryDB = await MongoMemoryReplSet.create({
          replSet: { count: 1, dbName: 'contractmemory' },
        })
        return {
          // Transactions off: on a fresh replset the first insert creates the
          // collection namespace, which races inside a transaction. Not what
          // this file tests.
          db: mongooseAdapter({ transactionOptions: false, url: memoryDB.getUri() }),
          teardown: () => memoryDB.stop(),
        }
      },
    },
  ],
]

const [[_label, harness]] = harnesses

describe(`virtual relationship field contract — ${_label}`, () => {
  /** `data` seen by the collection-level afterChange hook, keyed by operation. */
  const captured: Record<string, unknown> = {}
  let payload: Payload
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const { db, teardown: stopDb } = await harness.setup()

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
              hooks: {
                afterRead: [
                  async ({ data, req }) => {
                    if (!data?.id) {
                      return undefined
                    }
                    const found = await req.payload.find({
                      collection: 'res',
                      depth: 0,
                      limit: 0,
                      pagination: false,
                      where: { svcs: { in: [data.id] } },
                    })
                    // Counts executions so `select` gating is distinguishable
                    // from "hook ran and returned nothing".
                    captured.afterReadRuns = ((captured.afterReadRuns as number) ?? 0) + 1
                    return found.docs.map((d) => d.id)
                  },
                ],
              },
              relationTo: 'res',
              virtual: true,
            },
          ],
          hooks: {
            afterChange: [
              ({ data, operation }) => {
                captured[operation] = data
                return undefined
              },
            ],
          },
        },
        {
          slug: 'res',
          fields: [
            { name: 'name', type: 'text' },
            { name: 'svcs', type: 'relationship', hasMany: true, relationTo: 'svc' },
          ],
        },
      ],
      db,
      editor: lexicalEditor(),
      email: testEmailAdapter,
      secret: 'contract-secret',
      sharp,
      typescript: { outputFile: path.resolve(dirname, 'contract-types.ts') },
    })

    payload = await getPayload({ config })
    teardown = async () => {
      await payload.destroy()
      await stopDb()
    }
  })

  afterAll(async () => {
    await teardown?.()
  })

  it('Q1/Q2: the submitted virtual value reaches afterChange on create and update', async () => {
    const r1 = await payload.create({ collection: 'res', data: { name: 'R1' } })
    const r2 = await payload.create({ collection: 'res', data: { name: 'R2' } })

    const svc = await payload.create({
      collection: 'svc',
      data: { name: 'Haircut', resources: [r1.id, r2.id] },
    })
    expect((captured.create as Record<string, unknown>)?.resources).toEqual([r1.id, r2.id])

    await payload.update({ collection: 'svc', data: { resources: [r2.id] }, id: svc.id })
    expect((captured.update as Record<string, unknown>)?.resources).toEqual([r2.id])
  })

  it('Q3: the value is never persisted — no column, no stored key', async () => {
    const keys = await harness.rawKeys(payload, 'Haircut')
    // eslint-disable-next-line no-console
    console.log(`[${_label}] persisted keys:`, keys)
    expect(keys.length).toBeGreaterThan(0) // guard: we really did read the row
    expect(keys).not.toContain('resources')
    expect(keys).not.toContain('resources_id')
  })

  it('Q4/Q5: afterRead populates it, and `select` skips the hook', async () => {
    const svc = await payload.create({ collection: 'svc', data: { name: 'Colour' } })
    const r3 = await payload.create({ collection: 'res', data: { name: 'R3' } })
    await payload.update({ collection: 'res', data: { svcs: [svc.id] }, id: r3.id })

    // Q4 — linked from the RESOURCE side, visible from the SERVICE side, no sync code.
    const read = await payload.findByID({ collection: 'svc', depth: 0, id: svc.id })
    expect(read.resources).toEqual([r3.id])

    // Q5 — `select` short-circuits before field afterRead hooks run.
    const before = (captured.afterReadRuns as number) ?? 0
    const selected = await payload.findByID({
      collection: 'svc',
      depth: 0,
      id: svc.id,
      select: { name: true },
    })
    expect((captured.afterReadRuns as number) ?? 0).toBe(before)
    expect(selected.resources).toBeUndefined()
  })
})

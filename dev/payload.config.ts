import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  // Only spin up the in-memory replica set when actually running under Vitest.
  // Gating on NODE_ENV alone is too broad: CLI tooling that inherits NODE_ENV=test
  // (e.g. `payload generate:types`) would otherwise spawn an untracked 3-node mongod
  // cluster at config-import time that nothing ever tears down — orphaned mongods then
  // pile up and pin the CPU. `VITEST` is only set inside Vitest workers, which own the
  // replica-set lifecycle via getPayload/payload.destroy() in int.spec.ts.
  if (process.env.NODE_ENV === 'test' && process.env.VITEST) {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [],
      },
      {
        slug: 'posts',
        fields: [],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
      payloadReserve({
        cancellationNoticePeriod: 24,
        defaultBufferTime: 10,
        hooks: {
          afterBookingCreate: [
            ({ doc }) => {
              // eslint-disable-next-line no-console
              console.log(`[reservation-plugin] Booking created: ${String(doc.id)}`)
            },
          ],
          afterStatusChange: [
            ({ doc, newStatus, previousStatus }) => {
              // eslint-disable-next-line no-console
              console.log(
                `[reservation-plugin] Status changed: ${String(doc.id)} ${String(previousStatus)} -> ${String(newStatus)}`,
              )
            },
          ],
        },
        // statusMachine: {
        //   statuses: ['pending', 'waitlisted', 'confirmed', 'completed', 'cancelled', 'no-show'],
        //   transitions: {
        //     pending: ['waitlisted', 'confirmed', 'cancelled'],
        //     waitlisted: ['confirmed', 'cancelled'],
        //     confirmed: ['completed', 'cancelled', 'no-show'],
        //   },
        // },
        // userCollection: 'users',
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()

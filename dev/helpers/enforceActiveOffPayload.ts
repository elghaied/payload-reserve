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

/** Boots a Payload instance with payloadReserve({ enforceActive: false }) — a
 * dedicated instance (and spec file) because getPayload caches globally per
 * process, so it can't safely share a file with the default-config instance
 * used by validateActive.int.spec.ts. */
export async function buildEnforceActiveOffPayload(): Promise<{
  payload: Payload
  stop: () => Promise<void>
}> {
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
    db: mongooseAdapter({
      ensureIndexes: true,
      url: await testDbUri('enforceactiveoffmemory'),
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [payloadReserve({ enforceActive: false })],
    secret: 'enforce-active-off-test-secret',
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

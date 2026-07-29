import type { CollectionSlug, Field, Plugin } from 'payload'

import { smsPlugin } from '@elghaied/payload-plugin-sms'
import { mockAdapter } from '@elghaied/payload-plugin-sms/mock'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { externalBusyResolver } from './helpers/externalBusyState.js'
import { guestCancelOtpEndpoints } from './helpers/guestCancelEndpoints.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const MT = Boolean(process.env.MT)

const buildConfigWithMemoryDB = async () => {
  // Opt-in Postgres harness: `PG_URL=... pnpm test:int` runs the same suite
  // against a real Postgres instead of the in-memory Mongo replica set. It
  // exists because transaction semantics differ between the two — Mongo aborts
  // a write-conflict loser, Postgres blocks it — and the booking lock's
  // correctness depends on that behaviour. Unset, nothing here changes.
  if (process.env.PG_URL) {
    process.env.DATABASE_URL = process.env.PG_URL
  }
  // Otherwise spin up the in-memory replica set, but only under Vitest. Gating
  // on NODE_ENV alone is too broad: CLI tooling that inherits NODE_ENV=test
  // (e.g. `payload generate:types`) would otherwise spawn an untracked 3-node
  // mongod cluster at config-import time that nothing ever tears down — orphaned
  // mongods then pile up and pin the CPU. `VITEST` is only set inside Vitest
  // workers, which own the replica-set lifecycle via getPayload/payload.destroy().
  else if (process.env.NODE_ENV === 'test' && process.env.VITEST) {
    // Prefer the run-wide replica set from dev/globalSetup.ts. Falling back to a
    // private cluster keeps this file usable outside Vitest (and if globalSetup
    // is ever removed), at the cost this file used to always pay.
    if (process.env.MEMORY_DB_URI) {
      // MEMORY_DB_URI is getUri() with no db argument: `mongodb://host/?replicaSet=name`
      // — empty path, query already present. Concatenating the db name onto the end
      // of that string lands it inside the replicaSet query value instead of the
      // path, producing a replica set name that doesn't exist and failing server
      // selection. The URL API inserts it in the right place instead.
      const url = new URL(process.env.MEMORY_DB_URI)
      url.pathname = '/payloadmemory'
      url.searchParams.set('retryWrites', 'true')
      process.env.DATABASE_URL = url.toString()
    } else {
      const memoryDB = await MongoMemoryReplSet.create({
        replSet: {
          count: 3,
          dbName: 'payloadmemory',
        },
      })

      process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
    }
  }

  // Build the collections array; conditionally extend it when MT is enabled.
  const collections = [
    {
      slug: 'users',
      auth: true,
      fields: [] as Field[],
    },
    {
      slug: 'posts',
      fields: [] as Field[],
    },
    {
      slug: 'media',
      fields: [] as Field[],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
    },
    // Dev-only: stores short-lived OTP codes for guest SMS cancellation.
    {
      slug: 'cancel-otps',
      admin: {
        hidden: true,
      },
      fields: [
        {
          name: 'reservation',
          type: 'text' as const,
        },
        {
          name: 'code',
          type: 'text' as const,
        },
        {
          name: 'expiresAt',
          type: 'date' as const,
        },
      ],
    },
  ]

  if (MT) {
    // Add the tenants collection
    collections.push({
      slug: 'tenants',
      admin: { useAsTitle: 'name' },
      fields: [{ name: 'name', type: 'text' as const, required: true }],
    } as (typeof collections)[number])

    // Add superAdmin + tenants fields to the users collection
    const usersCollection = collections.find((c) => c.slug === 'users')
    if (usersCollection) {
      usersCollection.fields.push(
        { name: 'superAdmin', type: 'checkbox' as const },
        {
          name: 'tenants',
          type: 'array' as const,
          fields: [{ name: 'tenant', type: 'relationship' as const, relationTo: 'tenants' as CollectionSlug }],
        },
      )
    }
  }

  // Build the plugins array; conditionally append the multi-tenant plugin when MT is enabled.
  const plugins = [
    smsPlugin({
      adapter: mockAdapter({ defaultFrom: '+15550000000' }),
      collections: { logs: true },
      defaultFrom: '+15550000000',
      onSend: ({ result }) => {
        // eslint-disable-next-line no-console
        console.log(`[sms-mock] SMS to ${result.to}: ${result.body}`)
      },
      // The dashboard widget is an RSC that imports '@payload-config', which the
      // dev app's bundler can't resolve from node_modules. Disable it — the
      // sms-logs collection + the onSend console log give enough visibility.
      widgets: false,
    }),
    payloadReserve({
      // Dev: let the public /book page read services/resources without auth.
      access: {
        resources: { read: () => true },
        schedules: { read: () => true },
        services: { read: () => true },
      },
      allowGuestBooking: true,
      cancellationNoticePeriod: 24,
      defaultBufferTime: 10,
      getExternalBusy: externalBusyResolver,
      hooks: {
        afterBookingCreate: [
          ({ doc }) => {
            // eslint-disable-next-line no-console
            console.log(`[reservation-plugin] Booking created: ${String(doc.id)}`)
          },
          // Email cancellation: when a guest books with an email, send a
          // clickable cancel link. The test email adapter logs the email, and
          // we also log the bare URL on its own line for easy copy/paste.
          async ({ doc, req }) => {
            try {
              const guest = doc.guest as { email?: string; name?: string } | undefined
              const token = doc.cancellationToken as string | undefined
              if (guest?.email && token) {
                const host = req.headers?.get?.('host') ?? 'localhost:3000'
                const proto = req.headers?.get?.('x-forwarded-proto') ?? 'http'
                const cancelUrl = `${proto}://${host}/cancel?reservationId=${String(doc.id)}&token=${token}`
                await req.payload.sendEmail({
                  html: [
                    `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">`,
                    `<h2 style="margin:0 0 8px">Your booking is confirmed</h2>`,
                    `<p>Hi ${guest.name ?? 'there'}, thanks for booking.</p>`,
                    `<p>Changed your mind? <a href="${cancelUrl}">Cancel your booking</a>.</p>`,
                    `</div>`,
                  ].join(''),
                  subject: 'Your booking — cancel any time',
                  to: guest.email,
                })
                // eslint-disable-next-line no-console
                console.log(`[guest cancel link] ${cancelUrl}`)
              }
            } catch (err) {
              req.payload.logger.warn({ err, msg: '[dev] guest cancel email failed' })
            }
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
      slotHolds: { enabled: true, ttlMinutes: 10 },
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
  ] as Plugin[]

  if (MT) {
    plugins.push(
      multiTenantPlugin({
        // `customers` is listed because this dev config runs payloadReserve in
        // STANDALONE mode (no userCollection), so `customers` is a
        // plugin-generated auth collection holding PII. Leaving it out would
        // make /api/reservation-customer-search return every tenant's
        // customers — and the boot diagnostic now says so.
        collections: {
          customers: {},
          reservations: {},
          resources: {},
          schedules: {},
          services: {},
        },
        tenantsArrayField: { includeDefaultField: false },
        userHasAccessToAllTenants: (user) => Boolean((user as { superAdmin?: boolean })?.superAdmin),
      }),
    )
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections,
    db: process.env.PG_URL
      ? postgresAdapter({
          pool: { connectionString: process.env.PG_URL },
          push: true,
        })
      : mongooseAdapter({
          ensureIndexes: true,
          url: process.env.DATABASE_URL || '',
        }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    endpoints: guestCancelOtpEndpoints,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins,
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      // Never fire-and-forget a generate:types child on boot — they outlive the
      // parent and pin the CPU (117 orphans observed after one test session).
      // Regenerate types explicitly via `pnpm dev:generate-types`.
      autoGenerate: false,
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()

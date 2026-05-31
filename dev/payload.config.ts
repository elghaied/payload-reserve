import { smsPlugin } from '@elghaied/payload-plugin-sms'
import { mockAdapter } from '@elghaied/payload-plugin-sms/mock'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadReserve } from 'payload-reserve'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { guestCancelOtpEndpoints } from './helpers/guestCancelEndpoints.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
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
      // Dev-only: stores short-lived OTP codes for guest SMS cancellation.
      {
        slug: 'cancel-otps',
        admin: {
          hidden: true,
        },
        fields: [
          {
            name: 'reservation',
            type: 'text',
          },
          {
            name: 'code',
            type: 'text',
          },
          {
            name: 'expiresAt',
            type: 'date',
          },
        ],
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    endpoints: guestCancelOtpEndpoints,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
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
        allowGuestBooking: true,
        cancellationNoticePeriod: 24,
        defaultBufferTime: 10,
        hooks: {
          afterBookingCreate: [
            ({ doc }) => {
              // eslint-disable-next-line no-console
              console.log(`[reservation-plugin] Booking created: ${String(doc.id)}`)
            },
            // Email cancellation: when a guest books with an email, send a cancel
            // link. The test email adapter logs it to the console.
            async ({ doc, req }) => {
              try {
                const guest = doc.guest as { email?: string } | undefined
                const token = doc.cancellationToken as string | undefined
                if (guest?.email && token) {
                  const cancelBody = JSON.stringify({ reservationId: doc.id, token })
                  await req.payload.sendEmail({
                    html: `<p>Thanks for booking. To cancel, POST this to <code>/api/reserve/cancel</code>:</p><pre>${cancelBody}</pre>`,
                    subject: 'Your booking — cancel any time',
                    to: guest.email,
                  })
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

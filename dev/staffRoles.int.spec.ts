import type { Payload } from 'payload'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, getPayload } from 'payload'
import { payloadReserve } from 'payload-reserve'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/defaults.js'
import { createCustomerSearchEndpoint } from '../src/endpoints/customerSearch.js'
import { testDbUri } from './helpers/testDbUri.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'

/**
 * A host whose one `users` collection holds admins and shop customers, told
 * apart by a `roles` ARRAY (`['admin']` / `['customer']`), with no
 * resourceOwnerMode or staffProvisioning. `staff: { roleField: 'roles' }` is
 * what lets the plugin's checks tell the admin from the customer.
 */
const dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginOptions = { staff: { roleField: 'roles', roles: ['admin'] }, userCollection: 'users' }

let payload: Payload
let stop: () => Promise<void>
let admin: Record<string, unknown>
let customer: Record<string, unknown>
let otherCustomer: Record<string, unknown>
let service: { id: number | string }
let resource: { id: number | string }

const asUser = (doc: Record<string, unknown>) => ({ ...doc, collection: 'users' })
const inDays = (days: number, hour = 10) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}
/** The hook's own message — Payload nests it under the generic field error. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    return JSON.stringify((err as { data?: unknown }).data ?? (err as Error).message)
  }
  return 'did not throw'
}

beforeAll(async () => {
  const db = await testDbUri('staffrolesmemory')
  const config = await buildConfig({
    admin: { importMap: { baseDir: path.resolve(dirname, '..') }, user: 'users' },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          {
            name: 'roles',
            type: 'select',
            hasMany: true,
            options: ['admin', 'customer'],
          },
        ],
      },
      { slug: 'media', fields: [], upload: { staticDir: path.resolve(dirname, '..', 'media') } },
    ],
    db: mongooseAdapter({ ensureIndexes: true, url: db.uri }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    plugins: [payloadReserve(pluginOptions)],
    secret: 'staff-roles-test-secret',
    typescript: { autoGenerate: false },
  })
  payload = await getPayload({ config })
  stop = async () => {
    await payload.destroy()
    await db.stop()
  }

  const mkUser = (email: string, roles: string[]) =>
    payload.create({
      collection: 'users',
      data: { email, password: 'testpass123', roles } as never,
      overrideAccess: true,
    }) as unknown as Promise<Record<string, unknown>>
  admin = await mkUser('owner@shop.test', ['admin'])
  customer = await mkUser('rider@shop.test', ['customer'])
  otherCustomer = await mkUser('other@shop.test', ['customer'])
  service = await payload.create({
    collection: 'services',
    data: { name: 'Tune-up', duration: 60, durationType: 'fixed' },
    overrideAccess: true,
  })
  resource = await payload.create({
    collection: 'resources',
    data: { name: 'Workbench', quantity: 10, services: [service.id] },
    overrideAccess: true,
  })
}, 60_000)

afterAll(async () => {
  await stop?.()
})

const pendingReservation = (startTime: string) =>
  payload.create({
    collection: 'reservations',
    data: { customer: customer.id, resource: resource.id, service: service.id, startTime } as never,
    overrideAccess: true,
  })

describe('userCollection + staff.roleField: an array-role admin is staff', () => {
  it('the admin can confirm a reservation; the customer cannot', async () => {
    const r = await pendingReservation(inDays(5))
    expect(
      await failure(
        payload.update({
          id: r.id,
          collection: 'reservations',
          data: { status: 'confirmed' } as never,
          overrideAccess: false,
          user: asUser(customer),
        }),
      ),
    ).toMatch(/Only staff can change a reservation status/)

    const updated = await payload.update({
      id: r.id,
      collection: 'reservations',
      data: { status: 'confirmed' } as never,
      overrideAccess: false,
      user: asUser(admin),
    })
    expect(updated.status).toBe('confirmed')
  })

  it('the admin can book for a customer; a customer naming someone else is pinned to self', async () => {
    const byAdmin = await payload.create({
      collection: 'reservations',
      data: {
        customer: otherCustomer.id,
        resource: resource.id,
        service: service.id,
        startTime: inDays(6),
      } as never,
      depth: 0,
      overrideAccess: false,
      user: asUser(admin),
    })
    expect(String(byAdmin.customer)).toBe(String(otherCustomer.id))

    const byCustomer = await payload.create({
      collection: 'reservations',
      data: {
        customer: otherCustomer.id,
        resource: resource.id,
        service: service.id,
        startTime: inDays(6, 12),
      } as never,
      depth: 0,
      overrideAccess: false,
      user: asUser(customer),
    })
    expect(String(byCustomer.customer)).toBe(String(customer.id))
  })

  it('the admin is exempt from the public booking window; the customer is not', async () => {
    const data = {
      customer: customer.id,
      resource: resource.id,
      service: service.id,
      startTime: inDays(-2),
    } as never
    expect(
      await failure(
        payload.create({ collection: 'reservations', data, overrideAccess: false, user: asUser(customer) }),
      ),
    ).toMatch(/startTime cannot be in the past/)

    const back = await payload.create({
      collection: 'reservations',
      data,
      overrideAccess: false,
      user: asUser(admin),
    })
    expect(back.id).toBeDefined()
  })

  it('customer search answers the admin, excludes admins from results, and refuses the customer', async () => {
    const config = resolveConfig(pluginOptions)
    config.slugs.customers = 'users' // plugin.ts does this for userCollection mode
    const endpoint = createCustomerSearchEndpoint(config)
    const call = (user: Record<string, unknown>) =>
      endpoint.handler({
        headers: new Headers(),
        payload,
        url: 'http://localhost/api/reservation-customer-search?search=shop.test',
        user: asUser(user),
      } as never)

    expect((await call(customer)).status).toBe(403)

    const res = await call(admin)
    expect(res.status).toBe(200)
    const emails = ((await res.json()) as { docs: Array<{ email: string }> }).docs.map((d) => d.email)
    expect(emails).toContain('rider@shop.test')
    expect(emails).not.toContain('owner@shop.test')
  })
})

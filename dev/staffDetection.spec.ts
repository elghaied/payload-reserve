import type { Config, Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import type { ReservationPluginConfig } from '../src/types.js'

import { resolveConfig } from '../src/defaults.js'
import { payloadReserve } from '../src/index.js'
import { isPrivilegedUser } from '../src/utilities/userRoles.js'

/**
 * Staff detection when staff and customers share one auth collection
 * (`userCollection`). The collection cannot tell them apart, so only a
 * configured rule can: `staff`, `resourceOwnerMode.adminRoles` or
 * `staffProvisioning.staffRoles`, each read from its own role field.
 */

/** resolveConfig plus the slug rewrite plugin.ts does for userCollection mode. */
function resolved(options: ReservationPluginConfig) {
  const config = resolveConfig(options)
  config.slugs.customers = config.userCollection ?? config.slugs.customers
  return config
}

const privileged = (options: ReservationPluginConfig, user: Record<string, unknown>) =>
  isPrivilegedUser({ id: '1', collection: 'users', ...user }, resolved(options))

describe('staff option', () => {
  it('matches an array-valued role field', () => {
    const options = { staff: { roleField: 'roles', roles: ['admin'] }, userCollection: 'users' }
    expect(privileged(options, { roles: ['admin'] })).toBe(true)
    expect(privileged(options, { roles: ['customer', 'admin'] })).toBe(true)
    expect(privileged(options, { roles: ['customer'] })).toBe(false)
    expect(privileged(options, { roles: [] })).toBe(false)
    expect(privileged(options, {})).toBe(false)
  })

  it('matches a string role on the default "role" field', () => {
    const options = { staff: { roles: ['admin', 'staff'] }, userCollection: 'users' }
    expect(privileged(options, { role: 'staff' })).toBe(true)
    expect(privileged(options, { role: 'customer' })).toBe(false)
    // The default field is "role", not "roles".
    expect(privileged(options, { roles: ['admin'] })).toBe(false)
  })

  it('accepts an isStaff function, combined with roles', () => {
    const options = {
      staff: {
        isStaff: (user: Record<string, unknown>) => user.isOwner === true,
        roles: ['admin'],
      },
      userCollection: 'users',
    }
    expect(privileged(options, { isOwner: true })).toBe(true)
    expect(privileged(options, { role: 'admin' })).toBe(true)
    expect(privileged(options, { isOwner: false, role: 'customer' })).toBe(false)
  })

  it('accepts isStaff alone', () => {
    const options = { staff: { isStaff: () => true }, userCollection: 'users' }
    expect(privileged(options, {})).toBe(true)
  })

  it('with no rule configured, everyone in the collection is a customer (unchanged)', () => {
    const options = { userCollection: 'users' }
    expect(privileged(options, { role: 'admin' })).toBe(false)
    expect(privileged(options, { roles: ['admin'] })).toBe(false)
  })

  it('does not change the two-collection model', () => {
    const config = resolveConfig({ staff: { roles: ['admin'] } })
    expect(isPrivilegedUser({ collection: 'users' }, config)).toBe(true)
    expect(isPrivilegedUser({ collection: 'customers' }, config)).toBe(false)
  })

  it('rejects a staff option with no roles and no isStaff', () => {
    expect(() => resolveConfig({ staff: {} })).toThrow(/staff needs a non-empty "roles"/)
    expect(() => resolveConfig({ staff: { roles: [] } })).toThrow(/staff needs/)
    expect(() => resolveConfig({ staff: { roles: [1] as never } })).toThrow(/array of strings/)
  })
})

describe('resourceOwnerMode.roleField', () => {
  it('is the field adminRoles are matched against', () => {
    const options = {
      resourceOwnerMode: { adminRoles: ['admin'], roleField: 'roles' },
      userCollection: 'users',
    }
    expect(privileged(options, { roles: ['admin'] })).toBe(true)
    expect(privileged(options, { role: 'admin' })).toBe(false)
  })

  it('keeps reading staffProvisioning.staffRoles from staffProvisioning.roleField', () => {
    const options = {
      resourceOwnerMode: { adminRoles: ['admin'], roleField: 'roles' },
      staffProvisioning: { roleField: 'role', staffRoles: ['staff'] },
      userCollection: 'users',
    }
    expect(privileged(options, { roles: ['admin'] })).toBe(true)
    expect(privileged(options, { role: 'staff' })).toBe(true)
    expect(privileged(options, { role: 'admin' })).toBe(false)
  })

  it('still defaults to staffProvisioning.roleField when unset (unchanged)', () => {
    const options = {
      resourceOwnerMode: { adminRoles: ['admin'] },
      staffProvisioning: { roleField: 'kind', staffRoles: ['staff'] },
      userCollection: 'users',
    }
    expect(privileged(options, { kind: 'admin' })).toBe(true)
    expect(privileged(options, { kind: 'staff' })).toBe(true)
  })
})

describe('D8: boot warning when userCollection has no staff rule', () => {
  const D8 = /no staff rule is configured/

  async function warningsFor(options: ReservationPluginConfig) {
    const users = { slug: 'users', auth: true, fields: [] }
    const config = payloadReserve(options)({
      collections: [users],
      endpoints: [],
    } as unknown as Config)
    const messages: string[] = []
    const payload = {
      config: { collections: config.collections },
      // eslint-disable-next-line @typescript-eslint/require-await
      db: { beginTransaction: async () => 'txn-1' },
      logger: { warn: (msg: string) => messages.push(msg) },
    } as unknown as Payload
    await config.onInit!(payload)
    return messages.join('\n')
  }

  it('warns in userCollection mode with no rule', async () => {
    expect(await warningsFor({ userCollection: 'users' })).toMatch(D8)
  })

  it('warns when resourceOwnerMode has no adminRoles', async () => {
    expect(await warningsFor({ resourceOwnerMode: {}, userCollection: 'users' })).toMatch(D8)
  })

  it('is silent with a staff rule', async () => {
    expect(
      await warningsFor({ staff: { roleField: 'roles', roles: ['admin'] }, userCollection: 'users' }),
    ).not.toMatch(D8)
    expect(await warningsFor({ staff: { isStaff: () => false }, userCollection: 'users' })).not.toMatch(D8)
  })

  it('is silent with resourceOwnerMode.adminRoles', async () => {
    expect(
      await warningsFor({ resourceOwnerMode: { adminRoles: ['admin'] }, userCollection: 'users' }),
    ).not.toMatch(D8)
  })

  it('is silent in standalone mode', async () => {
    expect(await warningsFor({})).not.toMatch(D8)
  })
})

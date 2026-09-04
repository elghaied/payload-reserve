import type { Access, CollectionConfig, PayloadRequest } from 'payload'

import type { ResolvedReservationPluginConfig, ResolvedResourceOwnerModeConfig } from '../types.js'

import { isPrivilegedUser } from './userRoles.js'

type CollectionAccess = NonNullable<CollectionConfig['access']>

/**
 * Overlay app-provided access overrides onto a base (owner-mode) access object,
 * per operation. Specifying only `read` keeps the base's create/update/delete
 * rules intact, instead of replacing them wholesale (review C9).
 */
export function composeAccess(
  base: CollectionAccess,
  override: CollectionConfig['access'],
): CollectionAccess {
  return { ...base, ...(override ?? {}) }
}

/**
 * Returns true if the requesting user is considered an "admin" for resource-owner mode:
 * - No user → deny
 * - adminRoles provided → the user's `roleField` value must be in that list
 * - adminRoles empty → no bypass role; all authenticated users are treated as owners
 *
 * Reads the configured `roleField` (not a hardcoded `user.role`) so apps using a
 * `roles: string[]` field — or any custom role field — aren't silently demoted.
 */
function isAdmin(user: Record<string, unknown>, adminRoles: string[], roleField: string): boolean {
  if (!adminRoles.length) {return false}
  const role = user[roleField] as string | string[] | undefined
  if (!role) {return false}
  return Array.isArray(role) ? role.some((r) => adminRoles.includes(r)) : adminRoles.includes(role)
}

/**
 * Access factories for Resources collection.
 * Owners may read/update/delete their own resources; anyone authenticated may create.
 */
export function makeResourceOwnerAccess(rom: ResolvedResourceOwnerModeConfig): CollectionAccess {
  const { adminRoles, ownerField, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [ownerField]: { equals: user.id } }
  }

  return {
    create: ({ req }: { req: PayloadRequest }) => Boolean(req.user),
    delete: ownerOrAdmin,
    read: ownerOrAdmin,
    update: ownerOrAdmin,
  }
}

/**
 * Access factories for Schedules collection.
 * A schedule's ownership is determined through its `resource.owner` relationship.
 */
export function makeScheduleOwnerAccess(rom: ResolvedResourceOwnerModeConfig): CollectionAccess {
  const { adminRoles, ownerField, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [`resource.${ownerField}`]: { equals: user.id } }
  }

  return {
    create: ({ req }: { req: PayloadRequest }) => Boolean(req.user),
    delete: ownerOrAdmin,
    read: ownerOrAdmin,
    update: ownerOrAdmin,
  }
}

/**
 * Access factories for Reservations collection.
 * Resource owners can see reservations for their resources (read-only);
 * mutations are admin-only to prevent owners from unilaterally cancelling guest bookings.
 */
export function makeReservationOwnerAccess(
  rom: ResolvedResourceOwnerModeConfig,
): CollectionAccess {
  const { adminRoles, ownerField, roleField } = rom

  const readAccess: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [`resource.${ownerField}`]: { equals: user.id } }
  }

  const adminOnly: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    return isAdmin(user, adminRoles, roleField)
  }

  return {
    create: adminOnly,
    delete: adminOnly,
    read: readAccess,
    update: adminOnly,
  }
}

/**
 * Access factories for Services collection when `ownedServices: true`.
 */
export function makeServiceOwnerAccess(
  rom: ResolvedResourceOwnerModeConfig,
  ownerField: string,
): CollectionAccess {
  const { adminRoles, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [ownerField]: { equals: user.id } }
  }

  return {
    create: ({ req }: { req: PayloadRequest }) => Boolean(req.user),
    delete: ownerOrAdmin,
    read: ownerOrAdmin,
    update: ownerOrAdmin,
  }
}

/**
 * Default access for the Reservations collection in standalone mode (no
 * `userCollection`, no `resourceOwnerMode`).
 *
 * Before this existed the collection fell through to Payload's built-in default,
 * `Boolean(user)`, on every operation — so any customer with a login could read,
 * rewrite, and delete every other customer's reservation through the stock
 * `/api/<reservations>` REST API. `enforceCustomerOwnership` only ever guarded
 * `create`. Reported privately by an external researcher against 4.1.0.
 *
 * - `create` is left alone (Payload's default: any authenticated user); the
 *   `enforceCustomerOwnership` hook pins the `customer` to the caller.
 * - `read`/`update`: staff/admin see everything; a customer sees only rows whose
 *   `customer` is themselves. Guest bookings have no `customer`, so no customer
 *   can reach them.
 * - `delete`: staff/admin only. Customers cancel through `/api/reserve/cancel`.
 *
 * Standalone mode is the only place this can be exact: `isPrivilegedUser` is
 * "not in the customers collection" there. Under `userCollection` staff and
 * customers share one collection, and without configured roles the plugin
 * cannot tell them apart — so it stays on Payload's default and the boot
 * diagnostic in plugin.ts says so instead.
 */
export function makeStandaloneReservationAccess(
  config: ResolvedReservationPluginConfig,
): CollectionAccess {
  const ownOrPrivileged: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    if (isPrivilegedUser(req.user, config)) {return true}
    return { customer: { equals: req.user.id } }
  }

  const privilegedOnly: Access = ({ req }: { req: PayloadRequest }) =>
    isPrivilegedUser(req.user, config)

  return {
    delete: privilegedOnly,
    read: ownOrPrivileged,
    update: ownOrPrivileged,
  }
}

/**
 * Default access for the standalone Customers auth collection. Same background
 * as `makeStandaloneReservationAccess`: on Payload's default every customer
 * could list every other customer's name/email/phone/notes, and — because
 * `update` covers the `password` field on an auth collection — set another
 * customer's password and log in as them.
 *
 * - `create` is left alone (Payload's default); consumers opening
 *   self-registration set `create: () => true`, as the docs show.
 * - `read`/`update`: staff/admin see everything; a customer sees only their own
 *   document (`id equals self`). That also scopes the `bookings` join, which
 *   runs the reservations `read` access when access checks are on.
 * - `delete`: staff/admin only.
 */
export function makeStandaloneCustomerAccess(
  config: ResolvedReservationPluginConfig,
): CollectionAccess {
  const selfOrPrivileged: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    if (isPrivilegedUser(req.user, config)) {return true}
    return { id: { equals: req.user.id } }
  }

  const privilegedOnly: Access = ({ req }: { req: PayloadRequest }) =>
    isPrivilegedUser(req.user, config)

  return {
    delete: privilegedOnly,
    read: selfOrPrivileged,
    update: selfOrPrivileged,
  }
}

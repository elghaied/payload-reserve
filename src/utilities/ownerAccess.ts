import type { Access, CollectionConfig, PayloadRequest } from 'payload'

import type { ResolvedReservationPluginConfig, ResolvedResourceOwnerModeConfig } from '../types.js'

import { isPrivilegedUser } from './userRoles.js'

type CollectionAccess = NonNullable<CollectionConfig['access']>

/** Payload 3's default rule, spelled out: Payload 4's default is admin-collection only. */
const anyUser: Access = ({ req }: { req: PayloadRequest }) => Boolean(req.user)

/**
 * Overlay app-provided access overrides onto a base (owner-mode) access object,
 * per operation. Specifying only `read` keeps the base's create/update/delete
 * rules intact, instead of replacing them wholesale (review C9).
 */
export function composeAccess(
  base: CollectionAccess,
  override: CollectionConfig['access'],
): CollectionAccess {
  // An explicit `undefined` in the override (`read: cond ? fn : undefined`)
  // must not clobber the base rule: a spread would set `read: undefined`,
  // which Payload treats as "no rule" and falls back to `Boolean(user)` —
  // silently reopening what the base closed.
  const defined = Object.fromEntries(
    Object.entries(override ?? {}).filter(([, v]) => v !== undefined),
  ) as CollectionAccess
  return { ...base, ...defined }
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
/** Public wrapper over `isAdmin` for hooks that need owner-mode admin detection. */
export function isOwnerModeAdmin(
  user: null | Record<string, unknown> | undefined,
  rom: ResolvedResourceOwnerModeConfig,
): boolean {
  if (!user) {return false}
  return isAdmin(user, rom.adminRoles, rom.roleField)
}

function isAdmin(user: Record<string, unknown>, adminRoles: string[], roleField: string): boolean {
  if (!adminRoles.length) {return false}
  const role = user[roleField] as string | string[] | undefined
  if (!role) {return false}
  return Array.isArray(role) ? role.some((r) => adminRoles.includes(r)) : adminRoles.includes(role)
}

/**
 * `create` rule for the owner-mode catalog collections: any authenticated user,
 * EXCEPT a customer when owners live in a different collection. It used to be
 * `Boolean(req.user)`, so with standalone Customers plus an `ownerCollection`
 * (or staff provisioning) every customer login could create Resources — and
 * Services under `ownedServices` — in the public catalog. When owners ARE the
 * customers collection (no `ownerCollection`, or `userCollection` mode) the
 * plugin cannot tell the two apart and the rule stays open.
 */
export function makeOwnerModeCreate(config?: ResolvedReservationPluginConfig): Access {
  const ownerCollection =
    config?.resourceOwnerMode?.ownerCollection ??
    config?.staffProvisioning?.userCollection ??
    config?.slugs.customers
  const customersAreOwners = !config || ownerCollection === config.slugs.customers
  return ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    return customersAreOwners || req.user.collection !== config.slugs.customers
  }
}

/**
 * Access factories for Resources collection.
 * Owners may read/update/delete their own resources; anyone authenticated may create.
 */
export function makeResourceOwnerAccess(
  rom: ResolvedResourceOwnerModeConfig,
  config?: ResolvedReservationPluginConfig,
): CollectionAccess {
  const { adminRoles, ownerField, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [ownerField]: { equals: user.id } }
  }

  return {
    create: makeOwnerModeCreate(config),
    delete: ownerOrAdmin,
    read: ownerOrAdmin,
    update: ownerOrAdmin,
  }
}

/**
 * Access factories for Schedules collection.
 * A schedule's ownership is determined through its `resource.owner` relationship.
 */
export function makeScheduleOwnerAccess(
  rom: ResolvedResourceOwnerModeConfig,
  config?: ResolvedReservationPluginConfig,
): CollectionAccess {
  const { adminRoles, ownerField, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [`resource.${ownerField}`]: { equals: user.id } }
  }

  return {
    create: makeOwnerModeCreate(config),
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
  config?: ResolvedReservationPluginConfig,
): CollectionAccess {
  const { adminRoles, roleField } = rom

  const ownerOrAdmin: Access = ({ req }: { req: PayloadRequest }) => {
    if (!req.user) {return false}
    const user = req.user as Record<string, unknown>
    if (isAdmin(user, adminRoles, roleField)) {return true}
    return { [ownerField]: { equals: user.id } }
  }

  return {
    create: makeOwnerModeCreate(config),
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
 * - `create`: any authenticated user; the `enforceCustomerOwnership` hook pins
 *   the `customer` to the caller.
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
    // Explicit since Payload 4, whose default admits only the admin user
    // collection (Payload 3's was `Boolean(user)`): a customer may create
    // their own booking through the collection API, and
    // enforceCustomerOwnership pins the `customer` to them.
    create: anyUser,
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
 * - `create`: staff/admin only; consumers opening self-registration set
 *   `create: () => true`, as the docs show.
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
    // Privileged only. Payload's default let any logged-in customer create
    // accounts for other people's addresses; hosts opening self-registration
    // already override this with `create: () => true`.
    create: privilegedOnly,
    delete: privilegedOnly,
    read: selfOrPrivileged,
    update: selfOrPrivileged,
  }
}

/**
 * Default access for Services, Resources and Schedules in standalone mode (no
 * `userCollection`, no `resourceOwnerMode`). Same finding class as the 4.1.1
 * Reservations/Customers fix, one collection over: on Payload's default a
 * customer login could deactivate a resource, set its quantity to 1, rewrite a
 * service's buffers, delete a schedule or post a ten-year exception onto any
 * resource through `/api/<slug>`.
 *
 * `read` is any authenticated user (consumers commonly open it to `() => true`
 * for public availability); only the writes are staff/admin-only.
 */
export function makeStandaloneCatalogAccess(
  config: ResolvedReservationPluginConfig,
): CollectionAccess {
  const privilegedOnly: Access = ({ req }: { req: PayloadRequest }) =>
    isPrivilegedUser(req.user, config)
  return {
    create: privilegedOnly,
    delete: privilegedOnly,
    // Explicit since Payload 4 (see makeStandaloneReservationAccess): any
    // signed-in user, customers included, may read the catalog.
    read: anyUser,
    update: privilegedOnly,
  }
}

/**
 * Write access applied to every plugin collection while `disabled: true`. The
 * kill switch strips every safety hook (conflict detection, status machine,
 * ownership pinning) but the collections stay registered so the schema is
 * stable — which left their REST write surface open to customers with none of
 * the validation. Staff keep writing; non-privileged users cannot write at all
 * until the plugin is re-enabled.
 */
export function makeDisabledWriteAccess(
  config: ResolvedReservationPluginConfig,
): CollectionAccess {
  const privilegedOnly: Access = ({ req }: { req: PayloadRequest }) =>
    isPrivilegedUser(req.user, config)
  return {
    create: privilegedOnly,
    delete: privilegedOnly,
    update: privilegedOnly,
  }
}

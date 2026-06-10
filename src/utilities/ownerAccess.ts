import type { Access, CollectionConfig, PayloadRequest } from 'payload'

import type { ResolvedResourceOwnerModeConfig } from '../types.js'

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

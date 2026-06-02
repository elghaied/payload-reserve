import type { ResolvedReservationPluginConfig } from '../types.js'

import { roleMatches } from '../hooks/users/provisionStaffResource.js'

/**
 * Roles considered privileged (staff/admin) — the union of `resourceOwnerMode`
 * admin roles and `staffProvisioning` staff roles. Empty when neither is set.
 */
export function privilegedRoles(config: ResolvedReservationPluginConfig): string[] {
  return [
    ...(config.resourceOwnerMode?.adminRoles ?? []),
    ...(config.staffProvisioning?.staffRoles ?? []),
  ]
}

/**
 * True if the request user is staff/admin (i.e. NOT a customer).
 *
 * Two-collection model (default): anyone whose collection differs from
 * `slugs.customers` is staff/admin — the original behaviour, unchanged.
 *
 * Single-collection model (`userCollection` set, so `slugs.customers` IS the
 * auth collection): collection can't distinguish staff from customers, so fall
 * back to the user's role against `privilegedRoles`. With no privileged roles
 * configured this returns false (safe — treats everyone as a customer).
 */
export function isPrivilegedUser(
  user: ({ collection?: string } & Record<string, unknown>) | null | undefined,
  config: ResolvedReservationPluginConfig,
): boolean {
  if (!user) { return false }
  if (user.collection !== config.slugs.customers) { return true }
  const roleField = config.staffProvisioning?.roleField ?? 'role'
  return roleMatches(user[roleField], privilegedRoles(config))
}

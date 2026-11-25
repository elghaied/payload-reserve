import type { ResolvedReservationPluginConfig } from '../types.js'

import { roleMatches } from '../hooks/users/provisionStaffResource.js'

/**
 * Role rules that mark a user as staff/admin, each read from its OWN field:
 * `staff.roles` on `staff.roleField`, `resourceOwnerMode.adminRoles` on
 * `resourceOwnerMode.roleField`, `staffProvisioning.staffRoles` on
 * `staffProvisioning.roleField`. Rules with no roles are dropped, so this is
 * empty when nothing is configured.
 */
export function staffRoleRules(
  config: ResolvedReservationPluginConfig,
): Array<{ field: string; roles: string[] }> {
  const sp = config.staffProvisioning
  const rom = config.resourceOwnerMode
  const rules = [
    { field: config.staff?.roleField ?? 'role', roles: config.staff?.roles ?? [] },
    // Same default chain resolveConfig uses for resourceOwnerMode.roleField.
    { field: rom?.roleField ?? sp?.roleField ?? 'role', roles: rom?.adminRoles ?? [] },
    { field: sp?.roleField ?? 'role', roles: sp?.staffRoles ?? [] },
  ]
  return rules.filter((r) => r.roles.length > 0)
}

/** True when any staff rule (role list or `staff.isStaff`) is configured. */
export function hasStaffRule(config: ResolvedReservationPluginConfig): boolean {
  return Boolean(config.staff?.isStaff) || staffRoleRules(config).length > 0
}

/**
 * True if the request user is staff/admin (i.e. NOT a customer).
 *
 * Two-collection model (default): anyone whose collection differs from
 * `slugs.customers` is staff/admin — the original behaviour, unchanged.
 *
 * Single-collection model (`userCollection` set, so `slugs.customers` IS the
 * auth collection): collection can't distinguish staff from customers, so fall
 * back to the configured staff rules (`staff`, `resourceOwnerMode.adminRoles`,
 * `staffProvisioning.staffRoles`). With none configured this returns false
 * (safe — treats everyone as a customer).
 */
export function isPrivilegedUser(
  user: ({ collection?: string } & Record<string, unknown>) | null | undefined,
  config: ResolvedReservationPluginConfig,
): boolean {
  if (!user) { return false }
  if (user.collection !== config.slugs.customers) { return true }
  if (config.staff?.isStaff?.(user)) { return true }
  return staffRoleRules(config).some((r) => roleMatches(user[r.field], r.roles))
}

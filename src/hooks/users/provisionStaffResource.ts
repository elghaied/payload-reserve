import type { CollectionAfterChangeHook, CollectionSlug } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

/** True if the user's role value (string or string[]) intersects staffRoles. */
export function roleMatches(role: unknown, staffRoles: string[]): boolean {
  if (Array.isArray(role)) {
    return role.some((r) => staffRoles.includes(r as string))
  }
  return typeof role === 'string' && staffRoles.includes(role)
}

/**
 * afterChange hook for the staff user collection. On create — or on an update
 * that promotes a user into a staff role — provisions a paired Resource owned
 * by that user, unless one already exists.
 *
 * Ownership is assigned via IMPERSONATION: the Resource is created with a `req`
 * whose `user` is the new staff user (spreading the original req preserves
 * `transactionID` for atomicity). The owner field's force-owner-to-req.user
 * rule then assigns the correct owner with no bypass flag — nothing to exploit.
 */
export const provisionStaffResource =
  (config: ResolvedReservationPluginConfig): CollectionAfterChangeHook =>
  async ({ context, doc, operation, previousDoc, req }) => {
    if (context?.skipReservationHooks) {
      return doc
    }

    const sp = config.staffProvisioning
    if (!sp) {
      return doc
    }

    const d = doc as Record<string, unknown>
    const isStaffNow = roleMatches(d[sp.roleField], sp.staffRoles)
    if (!isStaffNow) {
      return doc
    }

    if (operation === 'update') {
      // Skip if the user was already staff — provisioned on a prior save.
      const wasStaff = roleMatches(
        (previousDoc as Record<string, unknown> | undefined)?.[sp.roleField],
        sp.staffRoles,
      )
      if (wasStaff) {
        return doc
      }
    }

    const ownerField = config.resourceOwnerMode?.ownerField ?? 'owner'

    try {
      // Idempotency: skip if a resource already owns this user.
      const existing = await req.payload.find({
        collection: config.slugs.resources as unknown as CollectionSlug,
        depth: 0,
        limit: 1,
        req,
        where: { [ownerField]: { equals: d.id } },
      })
      if (existing.docs.length > 0) {
        return doc
      }

      let data: Record<string, unknown> = {
        name: (d[sp.nameFrom] as string) ?? (d.email as string),
        [ownerField]: d.id,
        quantity: 1,
        resourceType: sp.resourceType,
      }

      if (sp.beforeCreate) {
        data = await sp.beforeCreate({ data, req, user: d })
      }

      // Impersonate the new staff user so the owner field resolves to them, not
      // the admin who triggered the create. Spread preserves the transaction.
      await req.payload.create({
        collection: config.slugs.resources as unknown as CollectionSlug,
        data,
        req: { ...req, user: { ...d, collection: sp.userCollection } } as typeof req,
      })
    } catch (err) {
      req.payload.logger.error({
        err,
        msg: `provisionStaffResource: failed to provision a resource for user ${String(d.id)}`,
      })
    }

    return doc
  }

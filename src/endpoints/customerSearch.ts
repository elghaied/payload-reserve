import type { CollectionSlug, Endpoint, Field, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

import { collectionHasTenantField, readCookie, tenantWhereClause } from '../utilities/tenantFilter.js'
import { isPrivilegedUser, privilegedRoles } from '../utilities/userRoles.js'

/**
 * Inspect a collection's field list and return the set of top-level named
 * fields as a plain Set<string>. Unnamed fields (rows, groups without a name,
 * etc.) are skipped.
 */
function getNamedFields(fields: Field[]): Set<string> {
  const names = new Set<string>()
  for (const field of fields) {
    if ('name' in field) {
      names.add(field.name)
    }
  }
  return names
}

export function createCustomerSearchEndpoint(
  config: ResolvedReservationPluginConfig,
): Endpoint {
  return {
    handler: async (req) => {
      if (!req.user) {
        return Response.json({ message: 'Unauthorized' }, { status: 401 })
      }

      // Only staff/admin may search customers. Role-aware so it works when staff
      // and customers share one auth collection (userCollection set).
      if (!isPrivilegedUser(req.user, config)) {
        return Response.json({ message: 'Forbidden' }, { status: 403 })
      }

      const url = new URL(req.url!)
      const search = url.searchParams.get('search') ?? ''
      const limitRaw = Number(url.searchParams.get('limit') ?? '10')
      const pageRaw = Number(url.searchParams.get('page') ?? '1')
      // Non-numeric input falls back to defaults instead of passing NaN to the DB
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 50) : 10
      const page = Number.isFinite(pageRaw) ? Math.max(Math.floor(pageRaw), 1) : 1

      // Detect which fields exist on the target collection at runtime
      const collectionConfig = req.payload.collections[config.slugs.customers as unknown as CollectionSlug]?.config
      const availableFields: Set<string> = collectionConfig
        ? getNamedFields(collectionConfig.fields)
        : new Set()

      const hasName = availableFields.has('name')
      const hasFirstName = availableFields.has('firstName')
      const hasLastName = availableFields.has('lastName')
      const hasPhone = availableFields.has('phone')

      const andClauses: Where[] = []

      if (search) {
        const orClauses: Where[] = []

        if (hasName) {
          orClauses.push({ name: { contains: search } })
        }
        if (hasFirstName) {
          orClauses.push({ firstName: { contains: search } })
        }
        if (hasLastName) {
          orClauses.push({ lastName: { contains: search } })
        }
        // email is always present on auth collections
        orClauses.push({ email: { contains: search } })
        if (hasPhone) {
          orClauses.push({ phone: { contains: search } })
        }

        andClauses.push({ or: orClauses })
      }

      // Single-collection mode: staff/admin live in the same collection as
      // customers, so exclude privileged roles — the dropdown should list only
      // actual customers, not bookable-looking staff.
      if (config.userCollection) {
        const roleField = config.staffProvisioning?.roleField ?? 'role'
        const priv = privilegedRoles(config)
        if (priv.length > 0) {
          andClauses.push({ [roleField]: { not_in: priv } })
        }
      }

      // Tenant scoping: when the customers collection carries the multi-tenant
      // tenant field and a tenant is selected (cookie), restrict the search to
      // that tenant. Plain installs (no tenant field / no cookie) add nothing.
      const tenantClause = tenantWhereClause({
        hasField: collectionHasTenantField(collectionConfig, config.multiTenant.tenantField),
        tenantField: config.multiTenant.tenantField,
        tenantId: readCookie(req.headers?.get('cookie'), config.multiTenant.cookieName),
      })
      if (tenantClause) {
        andClauses.push(tenantClause)
      }

      const where: Where =
        andClauses.length === 0
          ? {}
          : andClauses.length === 1
            ? andClauses[0]
            : { and: andClauses }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (req.payload.find as any)({
        collection: config.slugs.customers,
        limit,
        // Delegate isolation to collection access control. The multi-tenant
        // plugin enforces tenancy through the user's memberships, which the
        // cookie clause above structurally cannot express — with userCollection
        // set, tenancy lives on a `tenants` ARRAY, not a flat `tenant` field.
        overrideAccess: false,
        page,
        req,
        where,
      })

      return Response.json({
        docs: (result.docs as Record<string, unknown>[]).map((doc) => {
          const entry: Record<string, unknown> = {
            id: doc['id'],
            email: doc['email'] ?? '',
          }

          if (hasName) {
            entry['name'] = doc['name'] ?? ''
          }
          if (hasFirstName) {
            entry['firstName'] = doc['firstName'] ?? ''
          }
          if (hasLastName) {
            entry['lastName'] = doc['lastName'] ?? ''
          }
          if (hasPhone) {
            entry['phone'] = doc['phone'] ?? ''
          }

          return entry
        }),
        hasNextPage: result.hasNextPage,
        totalDocs: result.totalDocs,
      })
    },
    method: 'get',
    path: '/reservation-customer-search',
  }
}

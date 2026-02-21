import type { CollectionSlug, Endpoint, Field, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

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

      const url = new URL(req.url!)
      const search = url.searchParams.get('search') ?? ''
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '10'), 50)
      const page = Math.max(Number(url.searchParams.get('page') ?? '1'), 1)

      // Detect which fields exist on the target collection at runtime
      const collectionConfig = req.payload.collections[config.slugs.customers as unknown as CollectionSlug]?.config
      const availableFields: Set<string> = collectionConfig
        ? getNamedFields(collectionConfig.fields)
        : new Set()

      const hasName = availableFields.has('name')
      const hasFirstName = availableFields.has('firstName')
      const hasLastName = availableFields.has('lastName')
      const hasPhone = availableFields.has('phone')

      let where: Where = {}

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

        where = { or: orClauses }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (req.payload.find as any)({
        collection: config.slugs.customers,
        limit,
        page,
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

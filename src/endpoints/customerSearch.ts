import type { Endpoint, Where } from 'payload'

import type { ResolvedReservationPluginConfig } from '../types.js'

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

      let where: Where = {}

      if (search && config.customerRole) {
        where = {
          and: [
            {
              or: [
                { name: { contains: search } },
                { phone: { contains: search } },
                { email: { contains: search } },
              ],
            },
            { role: { equals: config.customerRole } },
          ],
        }
      } else if (search) {
        where = {
          or: [
            { name: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
          ],
        }
      } else if (config.customerRole) {
        where = { role: { equals: config.customerRole } }
      }

      const result = await req.payload.find({
        collection: config.userCollection,
        limit,
        page,
        where,
      })

      return Response.json({
        docs: result.docs.map((doc: Record<string, unknown>) => ({
          id: doc.id,
          name: doc.name ?? '',
          email: doc.email ?? '',
          phone: doc.phone ?? '',
        })),
        hasNextPage: result.hasNextPage,
        totalDocs: result.totalDocs,
      })
    },
    method: 'get',
    path: '/reservation-customer-search',
  }
}

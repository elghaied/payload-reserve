import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

export const checkIdempotency =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks) {return data}
    if (operation !== 'create' || !data?.idempotencyKey) {return data}

    const { totalDocs } = await req.payload.count({
      collection: config.slugs.reservations as 'reservations',
      req,
      where: { idempotencyKey: { equals: data.idempotencyKey } },
    })

    if (totalDocs > 0) {
      throw new ValidationError({
        errors: [{ message: 'Duplicate reservation', path: 'idempotencyKey' }],
      })
    }
    return data
  }

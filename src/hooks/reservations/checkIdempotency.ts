import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

export const checkIdempotency =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks) {return data}
    if (operation !== 'create' || !data?.idempotencyKey) {return data}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { totalDocs } = await (req.payload.count as any)({
      collection: config.slugs.reservations,
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

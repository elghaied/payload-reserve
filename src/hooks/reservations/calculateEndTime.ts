import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { addMinutes } from '../../utilities/slotUtils.js'

export const calculateEndTime =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, req }) => {
    if (context?.skipReservationHooks) {return data}

    if (!data?.startTime || !data?.service) {return data}

    const serviceId = typeof data.service === 'object' ? data.service.id : data.service

    const service = await req.payload.findByID({
      id: serviceId,
      collection: config.slugs.services as 'reservation-services',
      req,
    })

    if (service?.duration) {
      const startDate = new Date(data.startTime)
      data.endTime = addMinutes(startDate, service.duration).toISOString()
    }

    return data
  }

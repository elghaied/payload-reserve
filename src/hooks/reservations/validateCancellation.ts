import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { hoursUntil } from '../../utilities/slotUtils.js'

export const validateCancellation =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  ({ context, data, operation, originalDoc }) => {
    if (context?.skipReservationHooks) {return data}

    if (operation !== 'update') {return data}

    const newStatus = data?.status
    const previousStatus = originalDoc?.status

    // Only check when transitioning to cancelled
    if (newStatus !== 'cancelled' || previousStatus === 'cancelled') {return data}

    const startTime = data?.startTime ?? originalDoc?.startTime
    if (!startTime) {return data}

    const startDate = new Date(startTime)
    const hours = hoursUntil(startDate)

    if (hours < config.cancellationNoticePeriod) {
      throw new ValidationError({
        errors: [
          {
            message: `Cancellations require at least ${config.cancellationNoticePeriod} hours notice. Only ${Math.round(hours)} hours until the appointment.`,
            path: 'status',
          },
        ],
      })
    }

    return data
  }

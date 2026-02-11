import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { ReservationStatus } from '../../types.js'

import { VALID_STATUS_TRANSITIONS } from '../../types.js'

export const validateStatusTransition = (): CollectionBeforeChangeHook =>
  ({ context, data, operation, originalDoc }) => {
    if (context?.skipReservationHooks) {return data}

    const newStatus = data?.status as ReservationStatus | undefined

    if (operation === 'create') {
      if (newStatus && newStatus !== 'pending') {
        throw new ValidationError({
          errors: [
            {
              message: 'New reservations must start with "pending" status.',
              path: 'status',
            },
          ],
        })
      }
      return data
    }

    // On update
    if (operation === 'update' && newStatus) {
      const previousStatus = originalDoc?.status as ReservationStatus | undefined

      if (previousStatus && previousStatus !== newStatus) {
        const allowed = VALID_STATUS_TRANSITIONS[previousStatus]
        if (!allowed || !allowed.includes(newStatus)) {
          throw new ValidationError({
            errors: [
              {
                message: `Cannot transition from "${previousStatus}" to "${newStatus}".`,
                path: 'status',
              },
            ],
          })
        }
      }
    }

    return data
  }

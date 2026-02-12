import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ReservationStatus } from '../../types.js'

import { VALID_STATUS_TRANSITIONS } from '../../types.js'

export const validateStatusTransition = (): CollectionBeforeChangeHook =>
  ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    const newStatus = data?.status as ReservationStatus | undefined

    if (operation === 'create') {
      const isAdmin = Boolean(req.user)
      const allowedOnCreate: ReservationStatus[] = isAdmin
        ? ['pending', 'confirmed']
        : ['pending']

      if (newStatus && !allowedOnCreate.includes(newStatus)) {
        const allowed = allowedOnCreate.map((s) => `"${s}"`).join(' or ')
        throw new ValidationError({
          errors: [
            {
              message: (req.t as PluginT)('reservation:errorInvalidCreateStatus', { allowed }),
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
                message: (req.t as PluginT)('reservation:errorInvalidTransition', {
                  from: previousStatus,
                  to: newStatus,
                }),
                path: 'status',
              },
            ],
          })
        }
      }
    }

    return data
  }

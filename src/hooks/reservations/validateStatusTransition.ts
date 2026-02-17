import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { validateTransition } from '../../services/AvailabilityService.js'

export const validateStatusTransition =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    const newStatus = data?.status as string | undefined
    const { statusMachine } = config

    if (operation === 'create') {
      const isAdmin = Boolean(req.user)
      const defaultStatus = statusMachine.defaultStatus
      const allowedOnCreate: string[] = isAdmin
        ? [defaultStatus, 'confirmed']
        : [defaultStatus]

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

      // Call beforeBookingCreate hooks (handled by plugin hooks wrapper)
      return data
    }

    // On update
    if (operation === 'update' && newStatus) {
      const previousStatus = originalDoc?.status as string | undefined

      if (previousStatus && previousStatus !== newStatus) {
        const result = validateTransition(previousStatus, newStatus, statusMachine)

        if (!result.valid) {
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

        // Call beforeBookingConfirm plugin hooks
        if (newStatus === 'confirmed' && config.hooks?.beforeBookingConfirm) {
          for (const hook of config.hooks.beforeBookingConfirm) {
            await hook({
              doc: originalDoc as Record<string, unknown>,
              newStatus,
              req,
            })
          }
        }

        // Call beforeBookingCancel plugin hooks
        if (newStatus === 'cancelled' && config.hooks?.beforeBookingCancel) {
          for (const hook of config.hooks.beforeBookingCancel) {
            await hook({
              doc: originalDoc as Record<string, unknown>,
              reason: data?.cancellationReason as string | undefined,
              req,
            })
          }
        }
      }
    }

    return data
  }

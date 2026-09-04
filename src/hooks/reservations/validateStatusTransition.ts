import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { validateTransition } from '../../services/AvailabilityService.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

export const validateStatusTransition =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}

    const newStatus = data?.status as string | undefined
    const { statusMachine } = config

    if (operation === 'create') {
      // context.allowConfirmedOnCreate is the escape hatch for payment hooks
      // that need to create confirmed reservations programmatically
      const hasContextBypass = Boolean(context?.allowConfirmedOnCreate)
      // Staff/admin detection: collection-based, with a role-based fallback for
      // single-collection deployments (userCollection set). See isPrivilegedUser.
      const isAdmin = isPrivilegedUser(req.user, config)
      const defaultStatus = statusMachine.defaultStatus
      const nonDefaultStatuses = statusMachine.transitions[defaultStatus] ?? []
      const allowedOnCreate: string[] = (isAdmin || hasContextBypass)
        ? [defaultStatus, ...nonDefaultStatuses]
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

      return data
    }

    // On update
    if (operation === 'update' && newStatus) {
      const previousStatus = originalDoc?.status as string | undefined

      if (previousStatus && previousStatus !== newStatus) {
        // The create branch limits a non-staff caller to the default status,
        // but this branch only ran the transition map — so a customer allowed
        // to update their own row (4.1.1) could PATCH `status: confirmed` and
        // fire the host's payment/confirmation hooks as the actor. A non-staff
        // user may only ever move a booking to the cancel status.
        if (
          req.user &&
          !isPrivilegedUser(req.user, config) &&
          newStatus !== statusMachine.cancelStatus
        ) {
          throw new ValidationError({
            errors: [{ message: 'Only staff can change a reservation status', path: 'status' }],
          })
        }

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
        if (newStatus === config.statusMachine.confirmStatus && config.hooks?.beforeBookingConfirm) {
          for (const hook of config.hooks.beforeBookingConfirm) {
            await hook({
              doc: { ...(originalDoc as Record<string, unknown>), ...(data as Record<string, unknown>) },
              newStatus,
              req,
            })
          }
        }

        // Call beforeBookingCancel plugin hooks
        if (newStatus === config.statusMachine.cancelStatus && config.hooks?.beforeBookingCancel) {
          for (const hook of config.hooks.beforeBookingCancel) {
            await hook({
              doc: { ...(originalDoc as Record<string, unknown>), ...(data as Record<string, unknown>) },
              reason: data?.cancellationReason as string | undefined,
              req,
            })
          }
        }
      }
    }

    return data
  }

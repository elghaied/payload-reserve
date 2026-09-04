import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { schedulingFieldsChanged } from '../../utilities/reservationChanges.js'
import { hoursUntil } from '../../utilities/slotUtils.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

/**
 * Cancellation notice period.
 *
 * - Measured against the STORED `startTime`, never the incoming one. Reading
 *   `data.startTime` let a customer send `{ startTime: yesterday, status:
 *   'cancelled' }` in one request and cancel a booking two hours out under a
 *   24-hour policy — with the refund hook seeing the fake start.
 * - Staff/admin are exempt: the rule is a customer policy, and without the
 *   exemption staff could not cancel an abusive booking inside the window.
 * - An authenticated customer also may not RESCHEDULE inside the window (the
 *   two-step "move it out, then cancel" bypass), and for them the old
 *   "already started, so anything goes" escape is closed too — a no-show
 *   cancelling one minute after start otherwise fired the refund pipeline.
 * - Callers with no user (Local API: host code, cron) keep the original
 *   semantics — blocked inside the window, free once the booking has started —
 *   so existing server-side cleanup keeps working.
 */
export const validateCancellation =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {return data}
    if (operation !== 'update') {return data}
    if (isPrivilegedUser(req.user, config)) {return data}

    const cancelStatus = config.statusMachine.cancelStatus
    const cancelling = data?.status === cancelStatus && originalDoc?.status !== cancelStatus
    const customerActor = req.user != null

    const storedStart = originalDoc?.startTime as string | undefined
    if (!storedStart) {return data}
    const hours = hoursUntil(new Date(storedStart))
    const period = config.cancellationNoticePeriod
    const insideWindow = hours < period && (customerActor || hours > 0)

    if (cancelling && insideWindow) {
      throw new ValidationError({
        errors: [
          {
            message: (req.t as PluginT)('reservation:errorCancellationNotice', {
              hours: String(Math.max(0, Math.round(hours))),
              period: String(period),
            }),
            path: 'status',
          },
        ],
      })
    }

    if (
      !cancelling &&
      customerActor &&
      hours < period &&
      schedulingFieldsChanged({
        data: data as Record<string, unknown>,
        originalDoc: originalDoc as Record<string, unknown> | undefined,
      })
    ) {
      throw new ValidationError({
        errors: [
          {
            message: `Changes to this reservation require at least ${period} hours notice`,
            path: 'startTime',
          },
        ],
      })
    }

    return data
  }

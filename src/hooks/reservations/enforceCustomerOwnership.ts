import type { CollectionBeforeChangeHook } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { extractId } from '../../utilities/resolveReservationItems.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

/**
 * Prevents a non-privileged authenticated user from creating — or, since the
 * standalone access defaults let a customer update their own row, re-assigning —
 * a reservation on behalf of another customer (mass assignment). The
 * `/api/reserve/book` endpoint already enforces this on create, but a logged-in
 * customer could reach the same write through Payload's default collection REST
 * API — this guard closes that route (review B3 parallel path). On update it
 * stops a customer handing their own reservation to someone else's account.
 * Staff/admin may still book for anyone (walk-ins); guest bookings (no
 * `customer`) are untouched.
 */
export const enforceCustomerOwnership =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }
    if ((operation !== 'create' && operation !== 'update') || !req.user) {
      return data
    }
    if (isPrivilegedUser(req.user, config)) {
      return data
    }

    const customer = data?.customer
    if (customer != null && customer !== '') {
      const customerId = extractId(customer)
      if (String(customerId) !== String(req.user.id)) {
        data.customer = req.user.id
      }
    } else if (operation === 'update' && data != null && 'customer' in data) {
      // Clearing `customer` on their own row would orphan it: still blocking
      // its slot, unreachable by them (access is `customer equals self`), and
      // cancellable only by staff. A customer cannot detach themselves.
      data.customer = req.user.id
    }

    return data
  }

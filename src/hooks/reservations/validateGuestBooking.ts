import type { CollectionBeforeChangeHook } from 'payload'

import { randomUUID } from 'node:crypto'
import { ValidationError } from 'payload'

import type { PluginT } from '../../translations/index.js'
import type { ResolvedReservationPluginConfig } from '../../types.js'

import { resolveGuestBookingAllowed } from '../../utilities/guestBooking.js'
import { mergeReservationData } from '../../utilities/reservationChanges.js'
import { extractId } from '../../utilities/resolveReservationItems.js'
import { isPrivilegedUser } from '../../utilities/userRoles.js'

type GuestData = { email?: string; name?: string; phone?: string }

export const validateGuestBooking =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, originalDoc, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }
    if (operation !== 'create' && operation !== 'update') {
      return data
    }

    // On update the customer-XOR-guest rule runs on the MERGED document: a
    // customer allowed to edit their own row could otherwise attach `guest`
    // data and turn an attributed booking into a customer-plus-guest hybrid.
    const source =
      operation === 'update'
        ? mergeReservationData(
            data as Record<string, unknown>,
            originalDoc as Record<string, unknown> | undefined,
          )
        : (data as Record<string, unknown>)
    const customer = source.customer
    const guest = source.guest as GuestData | undefined
    const hasCustomer = customer != null && customer !== ''
    const hasGuest =
      guest != null && (Boolean(guest.name) || Boolean(guest.email) || Boolean(guest.phone))

    if (!hasCustomer && !hasGuest) {
      throw new ValidationError({
        errors: [
          {
            message: (req.t as PluginT)('reservation:errorGuestOrCustomerRequired'),
            path: 'customer',
          },
        ],
      })
    }

    if (hasCustomer && hasGuest) {
      throw new ValidationError({
        errors: [
          {
            message: (req.t as PluginT)('reservation:errorGuestAndCustomer'),
            path: 'guest',
          },
        ],
      })
    }

    if (hasCustomer || operation === 'update') {
      return data
    }

    // Guest path
    if (!guest?.name) {
      throw new ValidationError({
        errors: [
          { message: (req.t as PluginT)('reservation:errorGuestNameRequired'), path: 'guest.name' },
        ],
      })
    }
    if (!guest.email && !guest.phone) {
      throw new ValidationError({
        errors: [
          {
            message: (req.t as PluginT)('reservation:errorGuestContactRequired'),
            path: 'guest.email',
          },
        ],
      })
    }

    // Gate by service — staff/admin bypass. Every service the booking touches
    // is gated, not just the top-level one: an `items[]` line on a
    // guest-disabled service used to slip past because only `data.service`
    // was checked.
    if (!isPrivilegedUser(req.user, config)) {
      const serviceIds = new Set<string>()
      const top = extractId(data.service)
      if (top !== undefined) {serviceIds.add(String(top))}
      for (const it of Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []) {
        const s = extractId(it.service)
        if (s !== undefined) {serviceIds.add(String(s))}
      }
      for (const serviceId of serviceIds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (req.payload.findByID as any)({
          id: serviceId,
          collection: config.slugs.services,
          depth: 0,
          disableErrors: true,
          // Skip the resources join — internal logic never reads it, and without this
          // every service read becomes an aggregation with a $lookup.
          joins: false,
          req,
        }).catch(() => null)
        if (service && !resolveGuestBookingAllowed(service, config.allowGuestBooking)) {
          throw new ValidationError({
            errors: [
              {
                message: (req.t as PluginT)('reservation:errorGuestNotAllowed'),
                path: 'guest',
              },
            ],
          })
        }
      }
    }

    // Always server-generate the cancellation token the host project delivers
    // to the guest — never honor a caller-supplied value (it's a secret).
    data.cancellationToken = randomUUID()

    return data
  }

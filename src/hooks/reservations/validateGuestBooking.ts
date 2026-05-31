import type { CollectionBeforeChangeHook } from 'payload'

import { randomUUID } from 'node:crypto'
import { ValidationError } from 'payload'

import type { ResolvedReservationPluginConfig } from '../../types.js'

import { resolveGuestBookingAllowed } from '../../utilities/guestBooking.js'

type GuestData = { email?: string; name?: string; phone?: string }

export const validateGuestBooking =
  (config: ResolvedReservationPluginConfig): CollectionBeforeChangeHook =>
  async ({ context, data, operation, req }) => {
    if (context?.skipReservationHooks) {
      return data
    }
    if (operation !== 'create') {
      return data
    }

    const customer = data?.customer
    const guest = data?.guest as GuestData | undefined
    const hasCustomer = customer != null && customer !== ''
    const hasGuest =
      guest != null && (Boolean(guest.name) || Boolean(guest.email) || Boolean(guest.phone))

    if (!hasCustomer && !hasGuest) {
      throw new ValidationError({
        errors: [
          {
            message: 'A reservation requires either a customer or guest contact information.',
            path: 'customer',
          },
        ],
      })
    }

    if (hasCustomer && hasGuest) {
      throw new ValidationError({
        errors: [
          {
            message: 'A reservation cannot have both a customer and guest contact information.',
            path: 'guest',
          },
        ],
      })
    }

    if (hasCustomer) {
      return data
    }

    // Guest path
    if (!guest?.name) {
      throw new ValidationError({
        errors: [{ message: 'Guest bookings require a name.', path: 'guest.name' }],
      })
    }
    if (!guest.email && !guest.phone) {
      throw new ValidationError({
        errors: [
          {
            message: 'Guest bookings require an email or phone number.',
            path: 'guest.email',
          },
        ],
      })
    }

    // Gate by service — admins (non-customer collection users) bypass.
    const isAdmin = req.user != null && req.user.collection !== config.slugs.customers
    if (!isAdmin) {
      const serviceId =
        typeof data.service === 'object'
          ? (data.service as { id?: string } | null)?.id
          : data.service
      if (serviceId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const service = await (req.payload.findByID as any)({
          id: serviceId,
          collection: config.slugs.services,
          depth: 0,
          req,
        })
        if (!resolveGuestBookingAllowed(service, config.allowGuestBooking)) {
          throw new ValidationError({
            errors: [
              {
                message: 'Guest bookings are not allowed for this service.',
                path: 'guest',
              },
            ],
          })
        }
      }
    }

    // Generate a cancellation token the host project can deliver to the guest.
    if (!data.cancellationToken) {
      data.cancellationToken = randomUUID()
    }

    return data
  }

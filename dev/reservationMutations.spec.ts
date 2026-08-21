import { describe, expect, it } from 'vitest'

import { performReservationPatch } from '../src/utilities/reservationPatch.js'

const MESSAGES = {
  failure: 'Could not update the status.',
  network: 'Could not reach the server. Check your connection and try again.',
  success: 'Status updated.',
}

const URL = 'http://localhost:3000/api/reservations/abc123'

describe('performReservationPatch', () => {
  it('returns the success message when the response is ok', async () => {
    const fetchImpl = (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch

    const result = await performReservationPatch({
      data: { status: 'confirmed' },
      fetchImpl,
      messages: MESSAGES,
      url: URL,
    })

    expect(result).toEqual({ message: MESSAGES.success, ok: true })
  })

  it('surfaces the nested Payload ValidationError message, not the generic wrapper', async () => {
    // Shaped like a real notice-period rejection: the useful text is nested at
    // errors[0].data.errors[0].message, while errors[0].message is Payload's own
    // generic "field is invalid" wrapper.
    const body = {
      errors: [
        {
          name: 'ValidationError',
          data: {
            errors: [{ message: 'You must cancel at least 24 hours in advance.', path: 'status' }],
          },
          message: 'The following field is invalid: status',
        },
      ],
    }
    const fetchImpl = (() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 400 }))) as typeof fetch

    const result = await performReservationPatch({
      data: { status: 'cancelled' },
      fetchImpl,
      messages: MESSAGES,
      url: URL,
    })

    expect(result).toEqual({
      message: 'You must cancel at least 24 hours in advance.',
      ok: false,
    })
  })

  it('falls back to the generic failure message and does not throw on a non-JSON body', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      )) as typeof fetch

    const result = await performReservationPatch({
      data: { status: 'confirmed' },
      fetchImpl,
      messages: MESSAGES,
      url: URL,
    })

    expect(result).toEqual({ message: MESSAGES.failure, ok: false })
  })

  it('returns the network-error message and does not throw when fetch itself rejects', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch

    const result = await performReservationPatch({
      data: { status: 'confirmed' },
      fetchImpl,
      messages: MESSAGES,
      url: URL,
    })

    expect(result).toEqual({ message: MESSAGES.network, ok: false })
  })
})

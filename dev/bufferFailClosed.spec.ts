/**
 * The conflict check must fail CLOSED when it cannot read a neighbouring
 * reservation's service. Until 4.1.3 the lookup error was swallowed, logged
 * only under `debug`, and replaced by zero buffers for the rest of the call —
 * so a transient database error let a back-to-back booking through the gap a
 * buffer should have blocked, silently. Driven over a fake adapter: no DB.
 */
import { describe, expect, it, vi } from 'vitest'

import { checkAvailability } from '../src/services/AvailabilityService.js'

const START = new Date('2031-03-03T10:00:00.000Z')
const END = new Date('2031-03-03T11:00:00.000Z')

function fakePayload(serviceRead: () => Promise<unknown>) {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const payload = {
    find: () =>
      Promise.resolve({
      docs: [
        {
          id: 'existing',
          endTime: '2031-03-03T10:00:00.000Z',
          resource: 'r1',
          service: 's1',
          startTime: '2031-03-03T09:00:00.000Z',
          status: 'confirmed',
        },
      ],
    }),
    findByID: async ({ collection }: { collection: string }) => {
      if (collection === 'resources') {
        return { id: 'r1', capacityMode: 'per-reservation', quantity: 1 }
      }
      return serviceRead()
    },
    logger,
  }
  return { logger, payload }
}

const run = (payload: unknown) =>
  checkAvailability({
    blockingStatuses: ['pending', 'confirmed'],
    bufferAfter: 0,
    bufferBefore: 0,
    endTime: END,
    guestCount: 1,
    payload: payload as never,
    req: {} as never,
    reservationSlug: 'reservations',
    resourceId: 'r1',
    resourceSlug: 'resources',
    servicesSlug: 'services',
    startTime: START,
  })

describe('bufferFor fails closed', () => {
  it('rejects the availability check when the service lookup throws, and logs at error level', async () => {
    const { logger, payload } = fakePayload(() => Promise.reject(new Error('connection reset')))
    await expect(run(payload)).rejects.toThrow('connection reset')
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      msg: expect.stringMatching(/refusing the availability check/),
    })
  })

  it('applies the neighbour buffer when the lookup succeeds', async () => {
    const { payload } = fakePayload(() =>
      Promise.resolve({ id: 's1', bufferTimeAfter: 30, bufferTimeBefore: 0 }),
    )
    // Existing booking ends 10:00 with a 30-minute after-buffer; a 10:00 start collides.
    const result = await run(payload)
    expect(result.available).toBe(false)
  })

  it('treats a service that no longer exists as zero buffer, with a warning', async () => {
    const { logger, payload } = fakePayload(() => Promise.resolve(null))
    const result = await run(payload)
    expect(result.available).toBe(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0][0])).toMatch(/no longer exists/)
    expect(logger.error).not.toHaveBeenCalled()
  })
})

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReservationMutations } from '../../src/components/hooks/useReservationMutations.js'
import { makeT } from './testUtils/pluginT.js'

const mockConfig = {
  admin: { custom: { reservationSlugs: { reservations: 'reservations' } } },
  routes: { api: '/api' },
  serverURL: 'http://localhost:3000',
}

vi.mock('@payloadcms/ui', () => ({
  // vi.mock stub named to match the real hook it replaces, not an actual React hook.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
  useConfig: () => ({ config: mockConfig }),
  // vi.mock stub named to match the real hook it replaces, not an actual React hook.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
  useTranslation: () => ({ t: makeT() }),
}))

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useReservationMutations', () => {
  it('transition() PATCHes just the target status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 200))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReservationMutations())
    const outcome = await result.current.transition('res-1', 'confirmed')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/reservations/res-1')
    expect(init.method).toBe('PATCH')
    // Sends cookies along with the request — required for an authenticated admin
    // fetch, and flagged as a behaviour change in the changeset for this hook.
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ status: 'confirmed' })
    expect(outcome).toEqual({ message: 'Status updated.', ok: true })
  })

  it('cancel() sends both the status and the cancellation reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 200))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReservationMutations())
    const outcome = await result.current.cancel('res-1', 'cancelled', 'Too busy that day')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      cancellationReason: 'Too busy that day',
      status: 'cancelled',
    })
    expect(outcome).toEqual({ message: 'Status updated.', ok: true })
  })

  it('cancel() omits cancellationReason when no reason is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 200))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useReservationMutations())
    await result.current.cancel('res-1', 'cancelled')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ status: 'cancelled' })
  })

  it('surfaces a failed mutation as { ok: false, message }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'nope' }] }, 400)),
    )

    const { result } = renderHook(() => useReservationMutations())
    const outcome = await result.current.transition('res-1', 'confirmed')

    expect(outcome).toEqual({ message: 'nope', ok: false })
  })
})

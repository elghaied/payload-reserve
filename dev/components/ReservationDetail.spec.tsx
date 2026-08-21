import type { ReactElement } from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CalendarReservation } from '../../src/components/shared/types.js'

import { ReservationDetailProvider } from '../../src/components/ReservationDetail/context.js'
import { ReservationDetail } from '../../src/components/ReservationDetail/index.js'
import { makeT } from './testUtils/pluginT.js'
import { DEFAULT_STATUS_MACHINE } from './testUtils/statusMachines.js'

const mockConfig = {
  admin: {
    custom: {
      reservationSlugs: { reservations: 'reservations' },
      reservationStatusMachine: DEFAULT_STATUS_MACHINE,
      reservationTimezone: 'UTC',
    },
  },
  routes: { api: '/api' },
  serverURL: '',
}

vi.mock('@payloadcms/ui', () => ({
  // vi.mock stub named to match the real hook it replaces, not an actual React hook.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
  useConfig: () => ({ config: mockConfig }),
  // vi.mock stub named to match the real hook it replaces, not an actual React hook.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
  useTranslation: () => ({ t: makeT() }),
}))

const baseDoc: CalendarReservation = {
  id: 'res-1',
  customer: { name: 'Jane Doe' },
  endTime: '2026-01-01T11:00:00.000Z',
  resource: { id: 'r1', name: 'Chair 1' },
  service: { name: 'Haircut' },
  startTime: '2026-01-01T10:00:00.000Z',
  status: 'pending',
}

function renderDetail(
  doc: CalendarReservation | null,
  opts: { onEdit?: (id: string) => void; refresh?: () => void } = {},
) {
  const refresh = opts.refresh ?? vi.fn()
  const close = vi.fn()
  const utils = render(
    <ReservationDetailProvider value={{ close, doc, refresh }}>
      <ReservationDetail onEdit={opts.onEdit} />
    </ReservationDetailProvider>,
  )
  return { ...utils, close, refresh }
}

function rerenderDetail(
  rerender: (ui: ReactElement) => void,
  doc: CalendarReservation | null,
  opts: { onEdit?: (id: string) => void; refresh: () => void },
) {
  rerender(
    <ReservationDetailProvider value={{ close: vi.fn(), doc, refresh: opts.refresh }}>
      <ReservationDetail onEdit={opts.onEdit} />
    </ReservationDetailProvider>,
  )
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReservationDetail', () => {
  it('renders the header, rows, and status action bar from the supplied doc', () => {
    renderDetail(baseDoc)

    expect(screen.getByText('Haircut')).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Chair 1')).toBeTruthy()
    expect(screen.getByText('Jane Doe')).toBeTruthy()
    // pending -> [confirmed, cancelled]
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows the guest name in place of a customer for a guest booking', () => {
    const guestDoc: CalendarReservation = {
      ...baseDoc,
      customer: undefined,
      guest: { name: 'Guest Person', email: 'guest@example.com' },
    }
    renderDetail(guestDoc)

    expect(screen.getByText('Guest')).toBeTruthy()
    expect(screen.getByText('Guest Person')).toBeTruthy()
    expect(screen.queryByText('Customer')).toBeNull()
  })

  it('resets feedback and busy when doc.id changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(null, 200)),
    )
    const refresh = vi.fn()
    const { rerender } = renderDetail(baseDoc, { refresh })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('status')
    expect(screen.getByText('Status updated.')).toBeTruthy()

    const otherDoc: CalendarReservation = { ...baseDoc, id: 'res-2', status: 'pending' }
    rerenderDetail(rerender, otherDoc, { refresh })

    expect(screen.queryByRole('status')).toBeNull()
    // busy also reset: the fresh doc's buttons are not stuck disabled.
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled()
  })

  it('does not paint a late-resolving mutation result onto a different, already-open doc', async () => {
    let resolveFetch!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))

    const refresh = vi.fn()
    const { rerender } = renderDetail(baseDoc, { refresh })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    // Busy while the request against res-1 is still in flight.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled())

    const otherDoc: CalendarReservation = { ...baseDoc, id: 'res-2', status: 'pending' }
    rerenderDetail(rerender, otherDoc, { refresh })
    expect(screen.queryByRole('status')).toBeNull()

    // Now let the stale request against res-1 resolve.
    resolveFetch(jsonResponse(null, 200))
    // Give the microtask queue a turn to run the resolved handler.
    await new Promise((r) => setTimeout(r, 0))

    // The calendar-wide refresh still happens (server state genuinely changed)...
    expect(refresh).toHaveBeenCalledTimes(1)
    // ...but nothing writes into res-2's banner, and res-2 isn't left busy.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled()
  })

  it('does not paint a stale result when the same reservation is closed and reopened while a mutation is in flight', async () => {
    let resolveFetch!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))

    const refresh = vi.fn()
    const { rerender } = renderDetail(baseDoc, { refresh })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    // Busy while the request against res-1 is still in flight.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled())

    // Close the drawer (doc goes null), then reopen the SAME reservation
    // before the in-flight request resolves.
    rerenderDetail(rerender, null, { refresh })
    rerenderDetail(rerender, baseDoc, { refresh })
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled()

    // Now let the stale request from the first open resolve.
    resolveFetch(jsonResponse(null, 200))
    await new Promise((r) => setTimeout(r, 0))

    // The mutation genuinely happened against the server...
    expect(refresh).toHaveBeenCalledTimes(1)
    // ...but the reopened drawer must not show its stale feedback or be left busy.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled()
  })

  it('prompts for a reason when cancelling, and sends it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 200))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'prompt').mockReturnValue('Client requested refund')

    renderDetail(baseDoc)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(window.prompt).toHaveBeenCalledWith('Why is this reservation being cancelled?')
    await screen.findByRole('status')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(requestInit.body as string)
    expect(body).toEqual({ cancellationReason: 'Client requested refund', status: 'cancelled' })
  })

  it('performs no mutation when the cancellation prompt is dismissed', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'prompt').mockReturnValue(null)

    renderDetail(baseDoc)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(window.prompt).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('surfaces the server error message on a failed mutation, not a generic string', async () => {
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, 400)))
    vi.spyOn(window, 'prompt').mockReturnValue('reason')

    renderDetail(baseDoc)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toBe('You must cancel at least 24 hours in advance.')
    expect(banner.textContent).not.toBe('Could not update the status.')
  })

  it('returns null for a null doc without crashing', () => {
    const { container } = renderDetail(null)
    expect(container.firstChild).toBeNull()
  })

  it('fires onEdit with the reservation id', () => {
    const onEdit = vi.fn()
    renderDetail(baseDoc, { onEdit })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith('res-1')
  })
})

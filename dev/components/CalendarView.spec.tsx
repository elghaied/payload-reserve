import type { ReactNode } from 'react'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CalendarViewProps } from '../../src/components/CalendarView/index.js'
import type { CalendarReservation } from '../../src/components/shared/types.js'

import { makeT } from './testUtils/pluginT.js'
import { DEFAULT_STATUS_MACHINE } from './testUtils/statusMachines.js'

/**
 * Coverage for the real `CalendarView` (`src/components/CalendarView/index.tsx`)
 * — its fetches, its event pills, and the reservation-detail drawer's open/
 * close/reopen lifecycle — exercised through the actual component rather than
 * a hand-rolled reimplementation of its mechanism (an earlier harness,
 * `DrawerLifecycle.spec.tsx`, did that; it has been retired now that these
 * tests cover everything it did, on the real component).
 *
 * `@payloadcms/ui`'s main entry is a single pre-bundled file with no
 * `ModalProvider` export, so the modal/drawer primitives are mocked here
 * rather than driven through a real provider. `openModal`/`closeModal` read
 * and write the same `mocks.openSlugs` array that backs `isModalOpen`, so
 * calling them from the component has the same effect as the test directly
 * mutating the array — which is how these tests simulate the drawer's own
 * close affordance acting on the modal without going through CalendarView at
 * all.
 */

const DETAIL_SLUG = 'drawer_1_reservation-detail'

const mocks = vi.hoisted(() => {
  const openSlugs: string[] = []
  return {
    closeModal: vi.fn((slug: string) => {
      const idx = openSlugs.indexOf(slug)
      if (idx !== -1) {
        openSlugs.splice(idx, 1)
      }
    }),
    openDrawer: vi.fn(),
    openModal: vi.fn((slug: string) => {
      if (!openSlugs.includes(slug)) {
        openSlugs.push(slug)
      }
    }),
    openSlugs,
  }
})

const mockConfig = {
  admin: {
    custom: {
      reservationSlugs: { reservations: 'reservations', resources: 'resources' },
      reservationStatusMachine: DEFAULT_STATUS_MACHINE,
      reservationTimezone: 'UTC',
    },
  },
  collections: [],
  routes: { api: '/api' },
  serverURL: '',
}

vi.mock('@payloadcms/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Drawer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="drawer">{children}</div>
    ),
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useConfig: () => ({ config: mockConfig }),
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useDocumentDrawer: () => [
      () => <div data-testid="doc-drawer" />,
      () => null,
      { openDrawer: mocks.openDrawer },
    ],
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useDrawerSlug: (slug: string) => `drawer_1_${slug}`,
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useModal: () => ({
      closeModal: mocks.closeModal,
      isModalOpen: (slug: string) => mocks.openSlugs.includes(slug),
      openModal: mocks.openModal,
    }),
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useTranslation: () => ({ i18n: { language: 'en' }, t: makeT() }),
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** CalendarView always calls `fetch` with a plain string, but the mock is typed
 * against the full `fetch` signature — this avoids `.toString()` on a `Request`,
 * which would stringify to the useless `[object Request]`. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

/**
 * Routes the calendar's several concurrent fetches by URL shape:
 * `/reserve/effective-timezone` (404 — keeps the static UTC fallback),
 * `/api/resources` (empty — no filter dropdown, no resource-availability
 * fetch), a `PATCH /api/reservations/:id` status mutation (always succeeds),
 * and `GET /api/reservations` split by whether it carries a `status` filter
 * (pending count/list) or a `startTime` range (the main calendar fetch),
 * further split by `depth` for the pending count (`depth=0`) vs the pending
 * list (`depth=1`).
 *
 * `reservationsSequence`, when given, hands back one array per successive
 * call to the main (non-pending) list endpoint, repeating the last entry
 * once exhausted — this is how a test simulates the calendar's own refresh()
 * no longer finding a reservation it had open (see "keeps the drawer
 * mounted..." below).
 */
function makeFetchMock(
  opts: {
    pending?: CalendarReservation[]
    reservations?: CalendarReservation[]
    reservationsSequence?: CalendarReservation[][]
  } = {},
) {
  const pending = opts.pending ?? []
  const sequence = opts.reservationsSequence ?? [opts.reservations ?? []]
  let listCall = 0
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    if (url.includes('/reserve/effective-timezone')) {
      return Promise.resolve(jsonResponse({}, 404))
    }
    if (url.includes('/api/resources')) {
      return Promise.resolve(jsonResponse({ docs: [], totalDocs: 0 }))
    }
    if (url.includes('/api/reservations')) {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return Promise.resolve(jsonResponse(null, 200))
      }
      if (url.includes('status')) {
        if (url.includes('depth=0')) {
          return Promise.resolve(jsonResponse({ totalDocs: pending.length }))
        }
        return Promise.resolve(jsonResponse({ docs: pending, totalDocs: pending.length }))
      }
      const docs = sequence[Math.min(listCall, sequence.length - 1)]
      listCall += 1
      return Promise.resolve(jsonResponse({ docs, totalDocs: docs.length }))
    }
    return Promise.resolve(jsonResponse({ docs: [] }))
  })
}

/** A time today (business timezone UTC, per `mockConfig`), so it always falls
 * inside the month grid's 42-day window regardless of what day the suite runs. */
function todayIso(hour: number): string {
  const d = new Date()
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

const reservationA: CalendarReservation = {
  id: 'res-a',
  customer: { name: 'Jane Doe' },
  endTime: todayIso(11),
  resource: { id: 'r1', name: 'Chair 1' },
  service: { name: 'Haircut' },
  startTime: todayIso(10),
  status: 'pending',
}

const reservationB: CalendarReservation = {
  id: 'res-b',
  customer: { name: 'Bob Smith' },
  endTime: todayIso(15),
  resource: { id: 'r2', name: 'Chair 2' },
  service: { name: 'Shave' },
  startTime: todayIso(14),
  status: 'pending',
}

/**
 * Locates an event pill by the customer name in its tooltip. A pill's
 * enclosing day cell is ALSO `role="button"` and its accessible name
 * aggregates the pill's own text, so `getByRole('button', { name })` matches
 * both — the tooltip (unique per reservation, present only on the pill
 * itself) is the reliable handle.
 */
function getPill(customerName: string): HTMLElement {
  return screen.getByTitle(new RegExp(customerName))
}

async function renderCalendar(
  props: CalendarViewProps = {},
  fetchMock: ReturnType<typeof makeFetchMock> = makeFetchMock(),
) {
  vi.stubGlobal('fetch', fetchMock)
  const { CalendarView } = await import('../../src/components/CalendarView/index.js')
  const utils = render(<CalendarView {...props} />)
  await waitFor(() => expect(screen.queryByText('Loading reservations...')).toBeNull())
  const rerenderSame = () => utils.rerender(<CalendarView {...props} />)
  return { ...utils, rerenderSame }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.openSlugs.length = 0
})

describe('CalendarView', () => {
  it('renders fetched reservations as event pills', async () => {
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA, reservationB] }))

    expect(getPill('Jane Doe')).toBeTruthy()
    expect(getPill('Bob Smith')).toBeTruthy()
  })

  it('clicking a pill opens the detail drawer showing that reservation', async () => {
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))

    fireEvent.click(getPill('Jane Doe'))

    expect(mocks.openModal).toHaveBeenCalledWith(DETAIL_SLUG)
    const drawer = screen.getByTestId('drawer')
    expect(within(drawer).getByText('Haircut')).toBeTruthy()
    expect(within(drawer).getByText('Jane Doe')).toBeTruthy()
  })

  it('reopens the same reservation after being closed via the drawer’s own affordance', async () => {
    const { rerenderSame } = await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))

    fireEvent.click(getPill('Jane Doe'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    // Let CalendarView observe the modal actually being open (arms the
    // detailWasOpen ref) before it gets closed from outside.
    rerenderSame()

    // The drawer's own close affordance acts on the modal directly — never
    // through CalendarView's requestDrawer/openDetail path.
    mocks.openSlugs.length = 0
    rerenderSame()
    expect(screen.queryByTestId('drawer')).toBeNull()

    fireEvent.click(getPill('Jane Doe'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(within(screen.getByTestId('drawer')).getByText('Haircut')).toBeTruthy()
    expect(mocks.openModal).toHaveBeenCalledTimes(2)
  })

  it('never calls closeModal on mount or once the modal is already closed', async () => {
    const { rerenderSame } = await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))
    expect(mocks.closeModal).not.toHaveBeenCalled()

    fireEvent.click(getPill('Jane Doe'))
    rerenderSame()
    expect(mocks.closeModal).not.toHaveBeenCalled()

    // Closed via its own affordance — the modal is already gone by the time
    // CalendarView's own effect observes detailModalOpen go false.
    mocks.openSlugs.length = 0
    rerenderSame()
    expect(mocks.closeModal).not.toHaveBeenCalled()
  })

  it('detailDisabled routes a click to the document drawer, never the detail drawer', async () => {
    await renderCalendar({ detailDisabled: true }, makeFetchMock({ reservations: [reservationA] }))

    fireEvent.click(getPill('Jane Doe'))

    expect(mocks.openDrawer).toHaveBeenCalledTimes(1)
    expect(mocks.openModal).not.toHaveBeenCalledWith(DETAIL_SLUG)
    expect(screen.queryByTestId('drawer')).toBeNull()
  })

  it('renders detailSlot instead of the plugin’s own ReservationDetail', async () => {
    await renderCalendar(
      { detailSlot: <div data-testid="custom-slot">Custom Detail</div> },
      makeFetchMock({ reservations: [reservationA] }),
    )

    fireEvent.click(getPill('Jane Doe'))

    const drawer = screen.getByTestId('drawer')
    expect(within(drawer).getByTestId('custom-slot')).toBeTruthy()
    expect(within(drawer).getByText('Custom Detail')).toBeTruthy()
    // The plugin's own ReservationDetail body — its Edit button — must not
    // also be present.
    expect(within(drawer).queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('a pending-list row click also opens the detail drawer', async () => {
    await renderCalendar({}, makeFetchMock({ pending: [reservationA] }))

    fireEvent.click(screen.getByRole('button', { name: /^Pending/ }))
    const customerLink = await screen.findByText('Jane Doe')
    fireEvent.click(customerLink)

    expect(mocks.openModal).toHaveBeenCalledWith(DETAIL_SLUG)
    const drawer = screen.getByTestId('drawer')
    expect(within(drawer).getByText('Haircut')).toBeTruthy()
  })

  it('keeps the drawer mounted, with its own close still reachable, when the resolved doc goes null while open', async () => {
    // Second fetch (triggered by refresh() below) no longer includes the
    // reservation — e.g. confirming moved its startTime outside the
    // calendar's currently-fetched range.
    const fetchMock = makeFetchMock({ reservationsSequence: [[reservationA], []] })
    await renderCalendar({}, fetchMock)

    fireEvent.click(getPill('Jane Doe'))
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(within(screen.getByTestId('drawer')).getByText('Haircut')).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('drawer')).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(within(screen.getByTestId('drawer')).queryByText('Haircut')).toBeNull(),
    )

    // Gated on the id, not the resolved doc: the drawer is still mounted, so
    // its own close affordance remains reachable — nothing is stranded open
    // with no way to dismiss it.
    expect(screen.getByTestId('drawer')).toBeTruthy()
    // The modal itself never closed during this — CalendarView's own
    // closeModal call is unrelated to the doc going null.
    expect(mocks.closeModal).not.toHaveBeenCalled()
  })
})

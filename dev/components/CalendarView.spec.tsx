import type { ReactNode } from 'react'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CalendarViewProps } from '../../src/components/CalendarView/index.js'
import type { CalendarReservation } from '../../src/components/shared/types.js'
import type { ReservationCalendarConfig } from '../../src/types.js'

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
    /** The admin language `useTranslation().i18n.language` reports — switchable per test. */
    language: 'en',
    openDrawer: vi.fn(),
    openModal: vi.fn((slug: string) => {
      if (!openSlugs.includes(slug)) {
        openSlugs.push(slug)
      }
    }),
    openSlugs,
    windowInfo: { breakpoints: {} as Record<string, boolean>, eventsFired: 0 },
  }
})

const mockConfig = {
  admin: {
    custom: {
      reservationCalendar: undefined as ReservationCalendarConfig | undefined,
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
    // Renders the `Header` slot too: Payload's real Drawer drops its own
    // header (and the visible close button in it) whenever `Header` is
    // supplied, so the close affordance under test lives in ours.
    Drawer: ({ children, Header }: { children?: ReactNode; Header?: ReactNode }) => (
      <div data-testid="drawer">
        {Header}
        {children}
      </div>
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
    useTranslation: () => ({ i18n: { language: mocks.language }, t: makeT() }),
    // vi.mock stub named to match the real hook it replaces, not an actual React hook.
    // eslint-disable-next-line @eslint-react/hooks-extra/no-redundant-custom-hook
    useWindowInfo: () => mocks.windowInfo,
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

/**
 * Expectations are formatted in `'en'` — the mocked admin language the
 * component formats with — never in the runner's locale (`[]`), so the suite
 * passes under any `LANG`.
 */
const ADMIN_LOCALE = 'en'

/** The mobile day list's accessible name for today (business tz UTC). */
function todayListTitle(): string {
  return new Date().toLocaleDateString(ADMIN_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  })
}

/** The mobile month cell's accessible name for today. */
function todayCellName(): string {
  return new Date().toLocaleDateString(ADMIN_LOCALE, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/**
 * The floating "Create New" button, disambiguated from the mobile month
 * view's day-list "+" button — both carry the same accessible name.
 */
function getFab(): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'Create New' })
  const fab = buttons.find((b) => b.className.includes('fab'))
  if (!fab) {
    throw new Error('FAB button not found among "Create New" buttons')
  }
  return fab
}

/** Simulate Payload's WindowInfoProvider having measured a ≤768px viewport. */
function setPhoneViewport() {
  mocks.windowInfo = { breakpoints: { s: true }, eventsFired: 1 }
}

/** Simulate a measured desktop viewport (breakpoint `s` not matched). */
function setDesktopViewport() {
  mocks.windowInfo = { breakpoints: { s: false }, eventsFired: 1 }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.openSlugs.length = 0
  mocks.windowInfo = { breakpoints: {}, eventsFired: 0 }
  mocks.language = 'en'
  mockConfig.admin.custom.reservationCalendar = undefined
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

  it('the detail drawer has a visible close button that closes it', async () => {
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))

    fireEvent.click(getPill('Jane Doe'))

    // `general:close` is a Payload core key, not a plugin one — makeT() only
    // resolves `reservation:*` against en.json and echoes anything else back,
    // so the accessible name here is the raw key, not "Close".
    const close = within(screen.getByTestId('drawer')).getByRole('button', {
      name: 'general:close',
    })
    fireEvent.click(close)
    expect(mocks.closeModal).toHaveBeenCalledWith(DETAIL_SLUG)
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

describe('CalendarView default view', () => {
  it('opens on calendar.defaultView on desktop', async () => {
    mockConfig.admin.custom.reservationCalendar = { defaultView: 'week' }
    setDesktopViewport()
    await renderCalendar()
    // The week view's date label spans two dates ("14 Sep - 20 Sep 2026");
    // the month view's is "September 2026". Assert via the active tab instead.
    expect(screen.getByRole('button', { name: 'Week' }).className).toMatch(/viewToggleButtonActive/)
  })

  it('opens on calendar.mobileDefaultView on a phone', async () => {
    mockConfig.admin.custom.reservationCalendar = { defaultView: 'month', mobileDefaultView: 'day' }
    setPhoneViewport()
    await renderCalendar()
    expect(screen.getByRole('button', { name: 'Day' }).className).toMatch(/viewToggleButtonActive/)
  })

  it('ignores mobileDefaultView on desktop', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'day' }
    setDesktopViewport()
    await renderCalendar()
    expect(screen.getByRole('button', { name: 'Month' }).className).toMatch(/viewToggleButtonActive/)
  })

  it('does not override a tab the user already picked when the viewport is measured late', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'day' }
    // eventsFired 0: WindowInfoProvider has not measured yet (first client render).
    const { rerenderSame } = await renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    setPhoneViewport()
    rerenderSame()
    expect(screen.getByRole('button', { name: 'Week' }).className).toMatch(/viewToggleButtonActive/)
  })

  it('marks the wrapper with data-layout', async () => {
    setPhoneViewport()
    const { container } = await renderCalendar()
    expect(container.querySelector('[data-layout="mobile"]')).not.toBeNull()
  })
})

describe('CalendarView week start', () => {
  it('starts the month grid on Sunday by default', async () => {
    setDesktopViewport()
    await renderCalendar()
    const headers = await screen.findAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
    expect(headers.slice(0, 7).map((h) => h.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ])
  })

  it('honours calendar.weekStartsOn: the month grid starts on Monday', async () => {
    mockConfig.admin.custom.reservationCalendar = { weekStartsOn: 1 }
    setDesktopViewport()
    await renderCalendar()
    const headers = await screen.findAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
    expect(headers.slice(0, 7).map((h) => h.textContent)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
  })
})

describe('CalendarView on a phone', () => {
  it('renders Create New as a floating button, not a toolbar button', async () => {
    setPhoneViewport()
    await renderCalendar()
    // The mobile month view's day list also has a "Create New"-labelled +
    // button (see below), so the FAB must be disambiguated by its own class.
    const create = getFab()
    expect(create.className).toMatch(/fab/)
    expect(create.className).not.toMatch(/createButton/)
  })

  it('the floating button opens the create drawer', async () => {
    setPhoneViewport()
    await renderCalendar()
    fireEvent.click(getFab())
    expect(mocks.openDrawer).toHaveBeenCalled()
  })

  it('renders the toolbar Create New on desktop', async () => {
    setDesktopViewport()
    await renderCalendar()
    expect(screen.getByRole('button', { name: 'Create New' }).className).toMatch(/createButton/)
  })

  it('month view shows dots per day and lists the selected day’s bookings', async () => {
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA, reservationB] }))

    // No event pills in the grid on a phone…
    expect(screen.queryByText(/Haircut/, { selector: '[class*="eventItem"]' })).toBeNull()
    // …the day list (today is selected by default) carries the rows instead.
    const list = screen.getByRole('region', { name: todayListTitle() })
    expect(within(list).getByText(/Haircut/)).toBeTruthy()
    expect(within(list).getByText(/Shave/)).toBeTruthy()
    // and the today cell shows one dot per booking. The accessible name now
    // carries the booking count too (2 bookings today), hence the prefix match.
    const todayCell = screen.getByRole('button', {
      name: new RegExp('^' + escapeRegExp(todayCellName())),
      pressed: true,
    })
    expect(todayCell.querySelectorAll('[class*="dot"]:not([class*="dotRow"])').length).toBe(2)
  })

  it('tapping a day list row opens the detail drawer', async () => {
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))
    fireEvent.click(getPill('Jane Doe'))
    expect(mocks.openModal).toHaveBeenCalledWith(DETAIL_SLUG)
  })

  it('the day list header’s + opens the create drawer for that day', async () => {
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))
    const list = screen.getByRole('region', { name: todayListTitle() })
    fireEvent.click(within(list).getByRole('button', { name: 'Create New' }))
    expect(mocks.openDrawer).toHaveBeenCalled()
  })

  it('shows the empty hint when the selected day has no bookings', async () => {
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ reservations: [] }))
    expect(screen.getByText('No bookings on this day')).toBeTruthy()
  })

  it('week view renders a 7-chip day strip over a single day column', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'week' }
    setPhoneViewport()
    const { container } = await renderCalendar({}, makeFetchMock({ reservations: [reservationA] }))

    const strip = screen.getByRole('group')
    const chips = within(strip).getAllByRole('button')
    expect(chips).toHaveLength(7)
    // Prefix match: the label also carries the day's booking count, "(1)" here.
    expect(within(strip).getByRole('button', { pressed: true }).getAttribute('aria-label')).toMatch(
      new RegExp('^' + escapeRegExp(todayCellName())),
    )
    // Single day column, not the 7-column week grid.
    expect(container.querySelector('[class*="weekView"]')).toBeNull()
    expect(container.querySelector('[class*="dayView"]')).not.toBeNull()
    expect(getPill('Jane Doe')).toBeTruthy()
  })

  it('tapping a chip switches the column to that day without refetching', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'week' }
    setPhoneViewport()
    const fetchMock = makeFetchMock({ reservations: [reservationA] })
    await renderCalendar({}, fetchMock)
    const listCalls = () =>
      fetchMock.mock.calls.filter(
        ([input]) =>
          requestUrl(input).includes('/api/reservations') && requestUrl(input).includes('startTime'),
      ).length
    const before = listCalls()

    const strip = screen.getByRole('group')
    const chips = within(strip).getAllByRole('button')
    const other = chips.find((c) => c.getAttribute('aria-pressed') !== 'true')!
    fireEvent.click(other)

    expect(other.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTitle(/Jane Doe/)).toBeNull() // reservationA is today, not the tapped day
    expect(listCalls()).toBe(before)
  })

  it('day-strip chips show one status dot per booking and carry the count in their label', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'week' }
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ reservations: [reservationA, reservationB] }))

    const strip = screen.getByRole('group')
    const todayChip = within(strip).getByRole('button', {
      name: new RegExp('^' + escapeRegExp(todayCellName()) + ' \\(2\\)$'),
    })
    expect(todayChip.querySelectorAll('[class*="dot"]:not([class*="dotRow"])').length).toBe(2)

    // A day with nothing booked has no dots and no count suffix.
    const empty = within(strip)
      .getAllByRole('button')
      .find((c) => c !== todayChip)!
    expect(empty.getAttribute('aria-label')).not.toMatch(/\(\d+\)$/)
    expect(empty.querySelectorAll('[class*="dot"]:not([class*="dotRow"])').length).toBe(0)
  })

  it('Left/Right arrow keys move the day-strip selection and focus', async () => {
    mockConfig.admin.custom.reservationCalendar = { mobileDefaultView: 'week' }
    setPhoneViewport()
    await renderCalendar()

    const chips = within(screen.getByRole('group')).getAllByRole('button')
    const selectedIndex = chips.findIndex((c) => c.getAttribute('aria-pressed') === 'true')
    const target = chips[selectedIndex]
    target.focus()

    if (selectedIndex < chips.length - 1) {
      fireEvent.keyDown(target, { key: 'ArrowRight' })
      expect(chips[selectedIndex + 1].getAttribute('aria-pressed')).toBe('true')
      expect(document.activeElement).toBe(chips[selectedIndex + 1])
      fireEvent.keyDown(chips[selectedIndex + 1], { key: 'ArrowLeft' })
      expect(chips[selectedIndex].getAttribute('aria-pressed')).toBe('true')
    } else {
      // Today is Saturday: Right is a no-op at the edge, Left still moves.
      fireEvent.keyDown(target, { key: 'ArrowRight' })
      expect(target.getAttribute('aria-pressed')).toBe('true')
      fireEvent.keyDown(target, { key: 'ArrowLeft' })
      expect(chips[selectedIndex - 1].getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('pending rows carry data-labels so the card layout can name each cell', async () => {
    setPhoneViewport()
    await renderCalendar({}, makeFetchMock({ pending: [reservationA] }))
    fireEvent.click(screen.getByRole('button', { name: /Pending/ }))
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeTruthy())
    const row = screen.getByText('Jane Doe').closest('tr')!
    const labels = Array.from(row.querySelectorAll('td[data-label]')).map((td) =>
      td.getAttribute('data-label'),
    )
    expect(labels).toEqual(['Customer', 'Service', 'Resource', 'Date / Time'])
  })
})

describe('CalendarView month navigation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('steps one month at a time from the 31st instead of overshooting', async () => {
    // Fake only Date: waitFor still needs real timers.
    vi.useFakeTimers({ now: new Date('2026-01-31T12:00:00Z'), toFake: ['Date'] })
    await renderCalendar()

    const monthLabel = (monthIndex: number) =>
      new Date(2026, monthIndex, 15).toLocaleDateString(ADMIN_LOCALE, {
        month: 'long',
        timeZone: 'UTC',
        year: 'numeric',
      })
    expect(screen.getByText(monthLabel(0))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '→' }))
    // A bare setMonth from Jan 31 lands on "Feb 31" → Mar 3 and skips February.
    expect(screen.getByText(monthLabel(1))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '→' }))
    expect(screen.getByText(monthLabel(2))).toBeTruthy()
  })
})

describe('CalendarView admin language', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats the toolbar date label in the admin language, not the runtime locale', async () => {
    // The runtime (Node here, the browser in production) is en-US; the admin
    // language is French. The label must follow the admin language — that is
    // what keeps the server-rendered and client-rendered text identical.
    vi.useFakeTimers({ now: new Date('2026-08-15T12:00:00Z'), toFake: ['Date'] })
    mocks.language = 'fr'
    setDesktopViewport()
    const { container } = await renderCalendar()

    const label = container.querySelector('[class*="currentDate"]')
    expect(label?.textContent).toMatch(
      /janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\./,
    )
    expect(label?.textContent).not.toMatch(/August/)
  })
})

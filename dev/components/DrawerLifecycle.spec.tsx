import { Drawer, useDrawerSlug } from '@payloadcms/ui/elements/Drawer'
import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { facelessModal } from './testUtils/facelessModal.js'

const { ModalContainer, ModalProvider, useModal } = await facelessModal

type Doc = { id: string }

/**
 * This is a harness, not `CalendarView` itself. `CalendarView` is ~1500
 * lines, fetches on mount, and pulls in a large surface of admin-only
 * dependencies (document drawers, resource filters, pending-list state) that
 * have nothing to do with the mechanism under test. Rendering it whole here
 * would mean stubbing most of that surface just to reach the three hooks that
 * matter, which tests the stubs more than the mechanism.
 *
 * This harness reproduces the *mechanism* verbatim from
 * `src/components/CalendarView/index.tsx`:
 *   - `detailId` (not the resolved doc) is the single source of truth for
 *     whether the drawer is open.
 *   - `detailDoc` is resolved live from a list, and can legitimately go
 *     `null` while `detailId` stays set (the calendar's own comment: "e.g.
 *     confirming a pending row whose startTime falls outside the calendar's
 *     fetched range — refresh() no longer finds it in either list").
 *   - the modal is opened/closed by a `useEffect` keyed on `detailId` alone.
 *   - a `detailWasOpen` ref guards the "sync back" effect so it does not fire
 *     on the render between `setDetailId(id)` and the open effect actually
 *     running (see the comment in `CalendarView` this is copied from).
 *
 * It proves the *wiring*, not the calendar's visual chrome or its fetch
 * logic. See the report for what this does and does not cover — including one
 * thing this harness tried and failed to reproduce.
 */
function DrawerHarness({
  gateOnId = true,
  list,
}: {
  gateOnId?: boolean
  list: Doc[]
}) {
  const [detailId, setDetailId] = useState<null | string>(null)
  const slug = useDrawerSlug('reservation-detail')
  const { closeModal, isModalOpen, openModal } = useModal()
  const modalOpen = isModalOpen(slug)

  useEffect(() => {
    if (detailId) {
      openModal(slug)
    } else {
      closeModal(slug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, slug])

  // Copied verbatim from CalendarView, including the guard comment below.
  // Report finding: toggling this guard off in this harness (an earlier,
  // now-reverted version of this file) never made the "reopens" test below
  // fail — `act()`-wrapped `fireEvent` clicks flush effects to completion
  // before the assertions run, which closes the exact render-order window
  // this guard defends against. It is kept here, always on, because it is
  // still part of the real mechanism being reproduced — just not a window
  // this particular harness can hold open long enough to prove.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (modalOpen) {
      wasOpen.current = true
      return
    }
    // Only clear once the modal has actually been open. Without this guard the
    // effect fires on the render between `setDetailId(id)` and `openModal(...)`,
    // when the modal is still closed, and immediately cancels the open.
    if (wasOpen.current) {
      wasOpen.current = false
      setDetailId(null)
    }
  }, [modalOpen])

  const doc = useMemo(
    () => (detailId ? (list.find((d) => d.id === detailId) ?? null) : null),
    [detailId, list],
  )

  // `gateOnId: false` reproduces the pre-fix bug — the one this file DOES
  // prove: gating the Drawer's mount on the resolved doc instead of the id.
  const gate = gateOnId ? detailId : doc

  return (
    <div>
      <button onClick={() => setDetailId('a')} type="button">
        open-a
      </button>
      <button onClick={() => setDetailId('b')} type="button">
        open-b
      </button>
      <span data-testid="modal-open">{String(modalOpen)}</span>
      {gate && (
        <Drawer Header={<h2>Detail</h2>} slug={slug}>
          <div data-testid="drawer-body">{doc ? doc.id : 'no-doc'}</div>
        </Drawer>
      )}
    </div>
  )
}

function closeButton(): HTMLElement {
  const el = document.querySelector('[id^="close-drawer__"]')
  if (!el) {
    throw new Error('no drawer close button found')
  }
  return el as HTMLElement
}

describe('reservation detail drawer lifecycle (harness over CalendarView mechanism)', () => {
  it('opens, closes via the drawer’s own close affordance, and reopens the same item', () => {
    render(
      <ModalProvider>
        <ModalContainer />
        <DrawerHarness list={[{ id: 'a' }, { id: 'b' }]} />
      </ModalProvider>,
    )

    fireEvent.click(screen.getByText('open-a'))
    expect(screen.getByTestId('drawer-body').textContent).toBe('a')
    expect(screen.getByTestId('modal-open').textContent).toBe('true')

    fireEvent.click(closeButton())
    expect(screen.queryByTestId('drawer-body')).toBeNull()
    expect(screen.getByTestId('modal-open').textContent).toBe('false')

    // Reopening the same item after a real close must work, not get silently
    // swallowed — the scenario `detailWasOpen` exists to protect (see the
    // harness comment above for what this assertion does and does not prove).
    fireEvent.click(screen.getByText('open-a'))
    expect(screen.getByTestId('drawer-body').textContent).toBe('a')
    expect(screen.getByTestId('modal-open').textContent).toBe('true')
  })

  it('does not strand an open modal when the resolved doc goes null while open', () => {
    const { rerender } = render(
      <ModalProvider>
        <ModalContainer />
        <DrawerHarness list={[{ id: 'a' }, { id: 'b' }]} />
      </ModalProvider>,
    )

    fireEvent.click(screen.getByText('open-a'))
    expect(screen.getByTestId('drawer-body').textContent).toBe('a')

    // Simulate the calendar's own refresh() no longer finding this
    // reservation in either fetched list (e.g. pending -> Confirm moved it
    // outside the currently-loaded range).
    rerender(
      <ModalProvider>
        <ModalContainer />
        <DrawerHarness list={[{ id: 'b' }]} />
      </ModalProvider>,
    )

    // The drawer stays mounted (gated on the id, not the doc)...
    expect(screen.getByTestId('drawer-body').textContent).toBe('no-doc')
    expect(screen.getByTestId('modal-open').textContent).toBe('true')
    // ...so its own close affordance is still there and still works. Nothing
    // is left open with no way to dismiss it.
    fireEvent.click(closeButton())
    expect(screen.getByTestId('modal-open').textContent).toBe('false')
    expect(screen.queryByTestId('drawer-body')).toBeNull()
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StatusActionBar } from '../../src/components/primitives/StatusActionBar/index.js'
import { makeT } from './testUtils/pluginT.js'
import { CUSTOM_STATUS_MACHINE, DEFAULT_STATUS_MACHINE } from './testUtils/statusMachines.js'

// StatusActionBar reads the status machine through `useReservationStatusMachine`,
// which in turn reads `useConfig`/`useTranslation` from `@payloadcms/ui`. Mocking
// just those two keeps the test from needing a real Payload admin config.
const configState = vi.hoisted(() => ({ machine: {} as Record<string, unknown> }))

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({
    config: { admin: { custom: { reservationStatusMachine: configState.machine } } },
  }),
  useTranslation: () => ({ t: makeT() }),
}))

describe('StatusActionBar', () => {
  it('renders one button per transition available from the current status', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    const onSelect = vi.fn()
    render(<StatusActionBar onSelect={onSelect} status="pending" />)

    // pending -> [confirmed, cancelled]
    expect(screen.getByRole('button', { name: 'Confirmed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders nothing, not an empty bar, for a status with no outgoing transitions', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    const { container } = render(<StatusActionBar onSelect={vi.fn()} status="completed" />)

    expect(container.firstChild).toBeNull()
  })

  it('renders noActionsFallback instead of nothing, when supplied, for a terminal status', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    render(
      <StatusActionBar
        noActionsFallback={<span>Nothing to do here</span>}
        onSelect={vi.fn()}
        status="completed"
      />,
    )

    expect(screen.getByText('Nothing to do here')).toBeTruthy()
  })

  it('ignores noActionsFallback and renders the bar when transitions exist', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    render(
      <StatusActionBar
        noActionsFallback={<span>Nothing to do here</span>}
        onSelect={vi.fn()}
        status="pending"
      />,
    )

    expect(screen.queryByText('Nothing to do here')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('disables every button while busy, and a disabled button does not fire onSelect', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    const onSelect = vi.fn()
    render(<StatusActionBar busy onSelect={onSelect} status="pending" />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Confirmed' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('passes the target status string to onSelect, not the click event', () => {
    configState.machine = DEFAULT_STATUS_MACHINE
    const onSelect = vi.fn()
    render(<StatusActionBar onSelect={onSelect} status="pending" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('cancelled')
    // Not an event object: a single string argument only.
    expect(onSelect.mock.calls[0]).toHaveLength(1)
    expect(typeof onSelect.mock.calls[0][0]).toBe('string')
  })

  it('works with a custom status vocabulary — nothing here hardcodes "cancelled"', () => {
    configState.machine = CUSTOM_STATUS_MACHINE
    const onSelect = vi.fn()
    render(<StatusActionBar onSelect={onSelect} status="submitted" />)

    // submitted -> [accepted, declined]; no built-in status name appears anywhere.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Confirmed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancelled' })).toBeNull()

    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith(expect.any(String))
    const [calledWith] = onSelect.mock.calls[0] as [string]
    expect(CUSTOM_STATUS_MACHINE.transitions.submitted).toContain(calledWith)
  })
})

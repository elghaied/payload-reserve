import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EventPill } from '../../src/components/primitives/EventPill/index.js'
import styles from '../../src/components/primitives/EventPill/EventPill.module.css'

const reservation = { id: 'res-1', startTime: '2026-01-01T10:00:00.000Z', status: 'pending' }

describe('EventPill', () => {
  it('calls onSelect with the reservation id and stops propagation to the day cell', () => {
    const onSelect = vi.fn()
    const outerClick = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div onClick={outerClick}>
        <EventPill label="Haircut" onSelect={onSelect} reservation={reservation} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('res-1')
    // The calendar's day cell has its own onClick underneath — a real click
    // event must not reach it.
    expect(outerClick).not.toHaveBeenCalled()
  })

  it('Enter activates it and stops propagation', () => {
    const onSelect = vi.fn()
    const outerKeyDown = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={outerKeyDown}>
        <EventPill label="Haircut" onSelect={onSelect} reservation={reservation} />
      </div>,
    )

    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('res-1')
    expect(outerKeyDown).not.toHaveBeenCalled()
  })

  it('Space activates it and stops propagation', () => {
    const onSelect = vi.fn()
    const outerKeyDown = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={outerKeyDown}>
        <EventPill label="Haircut" onSelect={onSelect} reservation={reservation} />
      </div>,
    )

    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })

    expect(onSelect).toHaveBeenCalledWith('res-1')
    expect(outerKeyDown).not.toHaveBeenCalled()
  })

  it('does not activate on other keys, and lets the event keep bubbling (no preventDefault)', () => {
    const onSelect = vi.fn()
    const outerKeyDown = vi.fn()
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={outerKeyDown}>
        <EventPill label="Haircut" onSelect={onSelect} reservation={reservation} />
      </div>,
    )

    // fireEvent returns the dispatchEvent() result: true means the event was
    // NOT cancelled (preventDefault was never called).
    const notCancelled = fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' })

    expect(onSelect).not.toHaveBeenCalled()
    expect(notCancelled).toBe(true)
    // Not stopped either — the day cell (or, here, the wrapping div) still sees it.
    expect(outerKeyDown).toHaveBeenCalledTimes(1)
  })

  it('applies presentation colours inline', () => {
    render(
      <EventPill
        label="Haircut"
        onSelect={vi.fn()}
        presentation={{ background: '#dbeafe', foreground: '#1e40af' }}
        reservation={reservation}
      />,
    )

    const el = screen.getByRole('button')
    expect(el.style.background).toBe('rgb(219, 234, 254)')
    expect(el.style.color).toBe('rgb(30, 64, 175)')
  })

  it('renders children and applies the expanded class only when children are present and not compact', () => {
    const { rerender } = render(
      <EventPill label="Haircut" onSelect={vi.fn()} reservation={reservation}>
        <span>extra</span>
      </EventPill>,
    )
    let el = screen.getByRole('button')
    expect(screen.getByText('extra')).toBeTruthy()
    expect(el.classList.contains(styles.eventItemExpanded)).toBe(true)

    // compact, with children: no expanded class.
    rerender(
      <EventPill compact label="Haircut" onSelect={vi.fn()} reservation={reservation}>
        <span>extra</span>
      </EventPill>,
    )
    el = screen.getByRole('button')
    expect(el.classList.contains(styles.eventItemExpanded)).toBe(false)

    // no children at all: no expanded class either.
    rerender(<EventPill label="Haircut" onSelect={vi.fn()} reservation={reservation} />)
    el = screen.getByRole('button')
    expect(el.classList.contains(styles.eventItemExpanded)).toBe(false)
  })
})

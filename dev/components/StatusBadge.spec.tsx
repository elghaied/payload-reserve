import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBadge } from '../../src/components/primitives/StatusBadge/index.js'

describe('StatusBadge', () => {
  it('renders the label', () => {
    render(<StatusBadge label="Confirmed" />)
    expect(screen.getByText('Confirmed')).toBeTruthy()
  })

  it('applies presentation colours inline when supplied', () => {
    render(
      <StatusBadge
        label="Confirmed"
        presentation={{ background: '#dbeafe', foreground: '#1e40af' }}
      />,
    )
    const el = screen.getByText('Confirmed')
    expect(el.style.background).toBe('rgb(219, 234, 254)')
    expect(el.style.color).toBe('rgb(30, 64, 175)')
  })

  it('renders with no inline style when presentation is omitted', () => {
    render(<StatusBadge label="Confirmed" />)
    const el = screen.getByText('Confirmed')
    expect(el.style.background).toBe('')
    expect(el.style.color).toBe('')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DetailRow } from '../../src/components/primitives/DetailRow/index.js'

describe('DetailRow', () => {
  it('renders the label and a string value', () => {
    render(<DetailRow label="Resource" value="Chair 1" />)
    expect(screen.getByText('Resource')).toBeTruthy()
    expect(screen.getByText('Chair 1')).toBeTruthy()
  })

  it('renders children instead of value when both are supplied', () => {
    render(
      <DetailRow label="Also books" value="should not appear">
        <span>Chair 2</span>
      </DetailRow>,
    )
    expect(screen.queryByText('should not appear')).toBeNull()
    expect(screen.getByText('Chair 2')).toBeTruthy()
  })

  it('renders nothing in the value column when neither is supplied', () => {
    render(<DetailRow label="Notes" />)
    expect(screen.getByText('Notes')).toBeTruthy()
  })
})

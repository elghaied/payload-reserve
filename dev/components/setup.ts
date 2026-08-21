import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library does not auto-clean when `globals` is off, and leaving mounted
// trees behind leaks DOM between tests — a later `getByRole` then matches a node
// from a previous test and the failure points at the wrong place.
afterEach(() => {
  cleanup()
})

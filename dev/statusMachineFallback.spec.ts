import { describe, expect, it } from 'vitest'

import { deriveCancelConfirm } from '../src/utilities/statusMachineFallback.js'

describe('deriveCancelConfirm', () => {
  it('prefers the explicit statuses when the config supplies them', () => {
    const machine = {
      cancelStatus: 'voided',
      confirmStatus: 'approved',
      statuses: ['new', 'approved', 'voided'],
      terminalStatuses: ['voided'],
      transitions: { new: ['approved', 'voided'] },
    }
    expect(deriveCancelConfirm(machine, 'new')).toEqual({
      cancelStatus: 'voided',
      confirmStatus: 'approved',
    })
  })

  it('does not let the heuristic override an explicit cancelStatus', () => {
    // The heuristic would pick 'archived' (first terminal transition); the
    // explicit cancelStatus must win.
    const machine = {
      cancelStatus: 'voided',
      statuses: ['new', 'archived', 'voided'],
      terminalStatuses: ['archived', 'voided'],
      transitions: { new: ['archived', 'voided'] },
    }
    expect(deriveCancelConfirm(machine, 'new').cancelStatus).toBe('voided')
  })

  it('derives from transitions when the explicit fields are absent', () => {
    const machine = {
      statuses: ['pending', 'confirmed', 'cancelled'],
      terminalStatuses: ['cancelled'],
      transitions: { pending: ['confirmed', 'cancelled'] },
    }
    expect(deriveCancelConfirm(machine, 'pending')).toEqual({
      cancelStatus: 'cancelled',
      confirmStatus: 'confirmed',
    })
  })

  it('falls back to the built-in names when nothing can be derived', () => {
    expect(deriveCancelConfirm(undefined, 'pending')).toEqual({
      cancelStatus: 'cancelled',
      confirmStatus: 'confirmed',
    })
  })
})

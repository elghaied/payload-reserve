import { describe, expect, it } from 'vitest'

import {
  buildStatusActionLabels,
  buildStatusLabels,
  buildStatusPresentation,
  BUILTIN_STATUSES,
} from '../src/utilities/statusPresentation.js'

describe('buildStatusPresentation', () => {
  it('preserves the exact built-in colours', () => {
    const p = buildStatusPresentation(BUILTIN_STATUSES)
    expect(p.pending).toEqual({ background: '#fef3c7', foreground: '#92400e' })
    expect(p.confirmed).toEqual({ background: '#dbeafe', foreground: '#1e40af' })
    expect(p.completed).toEqual({ background: '#d1fae5', foreground: '#065f46' })
    expect(p.cancelled).toEqual({ background: '#e5e7eb', foreground: '#6b7280' })
    expect(p['no-show']).toEqual({ background: '#fee2e2', foreground: '#991b1b' })
  })

  it('assigns palette entries to custom statuses, with a foreground', () => {
    const p = buildStatusPresentation(['pending', 'awaiting-deposit', 'voided'])
    expect(p.pending.background).toBe('#fef3c7')
    expect(p['awaiting-deposit'].background).toBe('#fde68a')
    expect(p['awaiting-deposit'].foreground).toBeTruthy()
    expect(p.voided.background).toBe('#c7d2fe')
    expect(p.voided.background).not.toBe(p['awaiting-deposit'].background)
  })

  it('cycles the palette when there are more custom statuses than colours', () => {
    const custom = ['a', 'b', 'c', 'd', 'e', 'f']
    const p = buildStatusPresentation(custom)
    expect(p.f.background).toBe(p.a.background)
  })

  it('returns an empty map for no statuses', () => {
    expect(buildStatusPresentation([])).toEqual({})
  })
})

describe('buildStatusLabels', () => {
  const t = ((key: string) => (key === 'reservation:statusPending' ? 'Pending' : key)) as never

  it('uses the translation when one exists', () => {
    expect(buildStatusLabels(['pending'], t).pending).toBe('Pending')
  })

  it('capitalises the raw status when the translation key is missing', () => {
    expect(buildStatusLabels(['voided'], t).voided).toBe('Voided')
  })

  it('title-cases each hyphen-separated word instead of capitalising only the first letter', () => {
    expect(buildStatusLabels(['awaiting-deposit'], t)['awaiting-deposit']).toBe('Awaiting Deposit')
  })

  it('title-cases each underscore-separated word', () => {
    expect(buildStatusLabels(['awaiting_deposit'], t)['awaiting_deposit']).toBe('Awaiting Deposit')
  })

  it('uses the real translation for every built-in status, so the fallback never fires for them', () => {
    const realT = ((key: string) => {
      const map: Record<string, string> = {
        'reservation:statusCancelled': 'Cancelled',
        'reservation:statusCompleted': 'Completed',
        'reservation:statusConfirmed': 'Confirmed',
        'reservation:statusNoShow': 'No Show',
        'reservation:statusPending': 'Pending',
      }
      return map[key] ?? key
    }) as never
    const labels = buildStatusLabels(BUILTIN_STATUSES, realT)
    expect(labels.pending).toBe('Pending')
    expect(labels.confirmed).toBe('Confirmed')
    expect(labels.completed).toBe('Completed')
    expect(labels.cancelled).toBe('Cancelled')
    expect(labels['no-show']).toBe('No Show')
  })
})

describe('buildStatusActionLabels', () => {
  const t = ((key: string) => key) as never
  const statusLabels = buildStatusLabels(BUILTIN_STATUSES, t)

  it('uses the translated action label when one exists, not the status label', () => {
    const actionT = ((key: string) =>
      key === 'reservation:actionConfirmed' ? 'Confirm' : key) as never
    const actions = buildStatusActionLabels(['confirmed'], statusLabels, actionT)
    expect(actions.confirmed).toBe('Confirm')
  })

  it('resolves the real action label for every built-in status', () => {
    const realActionT = ((key: string) => {
      const map: Record<string, string> = {
        'reservation:actionCancelled': 'Cancel',
        'reservation:actionCompleted': 'Complete',
        'reservation:actionConfirmed': 'Confirm',
        'reservation:actionNoShow': 'Mark no-show',
        'reservation:actionPending': 'Reopen',
      }
      return map[key] ?? key
    }) as never
    const realStatusLabels = buildStatusLabels(BUILTIN_STATUSES, realActionT)
    const actions = buildStatusActionLabels(BUILTIN_STATUSES, realStatusLabels, realActionT)
    expect(actions.pending).toBe('Reopen')
    expect(actions.confirmed).toBe('Confirm')
    expect(actions.completed).toBe('Complete')
    expect(actions.cancelled).toBe('Cancel')
    expect(actions['no-show']).toBe('Mark no-show')
  })

  it('falls back to the already-resolved status label for a custom status with no action translation', () => {
    const custom = buildStatusLabels(['voided'], t)
    const actions = buildStatusActionLabels(['voided'], custom, t)
    // No `reservation:actionVoided` translation exists, so it falls back to
    // the status label — which itself already fell back to the title-cased
    // raw status — not to the raw status directly.
    expect(actions.voided).toBe('Voided')
    expect(actions.voided).toBe(custom.voided)
  })

  it('returns an empty map for no statuses', () => {
    expect(buildStatusActionLabels([], {}, t)).toEqual({})
  })
})

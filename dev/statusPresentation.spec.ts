import { describe, expect, it } from 'vitest'

import {
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

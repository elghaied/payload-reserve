import { describe, expect, it } from 'vitest'

import { externalPillLabel } from '../src/utilities/externalPillLabel.js'

const TZ = 'Europe/Paris'

describe('externalPillLabel', () => {
  it('timed event on its own day → "HH:MM label" in the tenant tz', () => {
    const out = externalPillLabel(
      { end: '2026-07-06T12:45:00.000Z', label: 'Google/Outlook', start: '2026-07-06T12:15:00.000Z' },
      '2026-07-06', TZ, 'External event',
    )
    expect(out).toMatch(/14[:h]15/)
    expect(out).toContain('Google/Outlook')
  })

  it('all-day interval → label only, no time', () => {
    const out = externalPillLabel(
      { end: '2026-08-01T00:00:00.000Z', start: '2026-07-31T00:00:00.000Z' },
      '2026-07-31', TZ, 'External event',
    )
    expect(out).toBe('External event')
  })

  it('middle day of a multi-day interval → label only', () => {
    const out = externalPillLabel(
      { end: '2026-07-10T12:00:00.000Z', label: 'Conf', start: '2026-07-08T12:00:00.000Z' },
      '2026-07-09', TZ, 'External event',
    )
    expect(out).toBe('Conf')
  })

  it('missing label falls back to the provided fallback', () => {
    const out = externalPillLabel(
      { end: '2026-07-06T12:45:00.000Z', start: '2026-07-06T12:15:00.000Z' },
      '2026-07-06', TZ, 'External event',
    )
    expect(out).toContain('External event')
  })
})

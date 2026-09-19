import { describe, expect, it } from 'vitest'

import { safeLocale } from '../src/utilities/adminLocale.js'

describe('safeLocale', () => {
  it('passes a well-formed BCP 47 language through unchanged', () => {
    expect(safeLocale('fr')).toBe('fr')
    expect(safeLocale('zh-TW')).toBe('zh-TW')
    expect(safeLocale('en-US')).toBe('en-US')
  })

  it("falls back to 'en' for a host language key Intl would reject", () => {
    // A host may register any string as a language key (`i18n.supportedLanguages`);
    // `en_GB` throws RangeError in every Intl formatter, so it must never reach one.
    expect(safeLocale('en_GB')).toBe('en')
    expect(safeLocale('not a locale')).toBe('en')
  })

  it("falls back to 'en' when the language is empty or missing", () => {
    expect(safeLocale('')).toBe('en')
    expect(safeLocale(undefined)).toBe('en')
  })

  it('never throws, whatever the input', () => {
    expect(() => safeLocale('en_GB')).not.toThrow()
    expect(() => new Intl.DateTimeFormat(safeLocale('en_GB'))).not.toThrow()
  })
})

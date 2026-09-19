/**
 * The admin language (`useTranslation().i18n.language`) as a locale that is
 * safe to hand to `Intl` / `toLocaleDateString`.
 *
 * Payload lets a host register any string as a language key
 * (`i18n.supportedLanguages`); a non-BCP-47 key such as `en_GB` makes every
 * Intl formatter throw `RangeError: Incorrect locale information provided`,
 * which would take the whole calendar down on every render. This returns the
 * input when Intl accepts it and `'en'` otherwise — the same fallback Payload
 * itself uses for an unknown language. Pure; the check is `Intl.getCanonicalLocales`.
 */
export function safeLocale(language: string | undefined): string {
  if (!language) {
    return 'en'
  }
  try {
    Intl.getCanonicalLocales(language)
    return language
  } catch {
    return 'en'
  }
}

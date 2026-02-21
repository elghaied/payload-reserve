import en from './en.json' with { type: 'json' }

export const translations: Record<string, Record<string, unknown>> = {
  en: { reservation: en },
}

type EnKeys = keyof typeof en
/** Union of all valid plugin translation keys, e.g. `"reservation:fieldName"` */
export type PluginTranslationKeys = `reservation:${EnKeys}`

/** Helper type for plugin translation calls (bypasses DefaultTranslationKeys constraint) */
export type PluginT = (key: string, vars?: Record<string, unknown>) => string

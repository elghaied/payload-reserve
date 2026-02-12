import en from './en.json' with { type: 'json' }

export const translations: Record<string, Record<string, unknown>> = {
  en: { reservation: en },
}

/** Helper type for plugin translation calls (bypasses DefaultTranslationKeys constraint) */
export type PluginT = (key: string, vars?: Record<string, unknown>) => string

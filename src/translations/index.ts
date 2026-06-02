import ar from './ar.json' with { type: 'json' }
import de from './de.json' with { type: 'json' }
import en from './en.json' with { type: 'json' }
import es from './es.json' with { type: 'json' }
import fa from './fa.json' with { type: 'json' }
import fr from './fr.json' with { type: 'json' }
import hi from './hi.json' with { type: 'json' }
import id from './id.json' with { type: 'json' }
import pl from './pl.json' with { type: 'json' }
import ru from './ru.json' with { type: 'json' }
import tr from './tr.json' with { type: 'json' }
import zh from './zh.json' with { type: 'json' }

export const translations: Record<string, Record<string, unknown>> = {
  id: { reservation: id },
  ar: { reservation: ar },
  de: { reservation: de },
  en: { reservation: en },
  es: { reservation: es },
  fa: { reservation: fa },
  fr: { reservation: fr },
  hi: { reservation: hi },
  pl: { reservation: pl },
  ru: { reservation: ru },
  tr: { reservation: tr },
  zh: { reservation: zh },
}

type EnKeys = keyof typeof en
/** Union of all valid plugin translation keys, e.g. `"reservation:fieldName"` */
export type PluginTranslationKeys = `reservation:${EnKeys}`

/** Helper type for plugin translation calls (bypasses DefaultTranslationKeys constraint) */
export type PluginT = (key: string, vars?: Record<string, unknown>) => string

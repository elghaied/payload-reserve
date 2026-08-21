import en from '../../../src/translations/en.json'

/**
 * A `t()` stub that resolves against the plugin's real English strings
 * (`src/translations/en.json`) rather than echoing the key back. Assertions
 * on user-visible text this way check something meaningful, and stay in sync
 * with the shipped copy automatically.
 *
 * Falls back to the bare key for anything not present in `en.json` (e.g. a
 * deliberately custom-vocabulary status with no translation), matching
 * `buildStatusLabels`' own "translated !== key" fallback check.
 */
export function makeT(): (key: string, vars?: Record<string, unknown>) => string {
  return (key, vars) => {
    const short = key.startsWith('reservation:') ? key.slice('reservation:'.length) : key
    const template = (en as Record<string, string>)[short]
    if (!template) {
      return key
    }
    if (!vars) {
      return template
    }
    // Test stub; every caller here interpolates primitives (names, counts), never an object.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''))
  }
}

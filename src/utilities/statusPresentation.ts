import { statusToActionI18nKey, statusToI18nKey } from './i18nUtils.js'

export type StatusPresentation = {
  background: string
  foreground: string
}

/**
 * Colours for the five statuses the plugin ships by default. These pairs are
 * lifted verbatim from the `.statusX` rules that used to live in
 * `CalendarView.module.css`, so built-in statuses render identically.
 */
const BUILTIN_STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  cancelled: { background: '#e5e7eb', foreground: '#6b7280' },
  completed: { background: '#d1fae5', foreground: '#065f46' },
  confirmed: { background: '#dbeafe', foreground: '#1e40af' },
  'no-show': { background: '#fee2e2', foreground: '#991b1b' },
  pending: { background: '#fef3c7', foreground: '#92400e' },
}

export const BUILTIN_STATUSES = Object.keys(BUILTIN_STATUS_PRESENTATION)

/**
 * Backgrounds match the palette that shipped before; foregrounds are new — a
 * custom status previously got a background with no matching text colour.
 */
const CUSTOM_STATUS_PALETTE: StatusPresentation[] = [
  { background: '#fde68a', foreground: '#78350f' },
  { background: '#c7d2fe', foreground: '#3730a3' },
  { background: '#a7f3d0', foreground: '#065f46' },
  { background: '#fca5a5', foreground: '#7f1d1d' },
  { background: '#fdba74', foreground: '#7c2d12' },
]

/**
 * Resolve the colour pair for every status in the machine.
 *
 * `overrides` lets a consumer restyle specific statuses without forking the
 * calendar. Values are plain strings and land in an inline `style`, so a
 * consumer may pass a CSS variable reference (`var(--x)`) and keep light/dark
 * in its own token layer — the plugin stays colour-agnostic.
 *
 * An overridden custom status still advances the palette cursor exactly as
 * it would unoverridden — only the resulting colour is swapped for the
 * override. If overriding a status instead skipped the cursor advance, every
 * custom status declared after it would silently shift onto a different
 * palette colour depending on whether an earlier status happened to be
 * overridden.
 */
export function buildStatusPresentation(
  statuses: string[],
  overrides?: Partial<Record<string, StatusPresentation>>,
): Record<string, StatusPresentation> {
  const result: Record<string, StatusPresentation> = {}
  let customIndex = 0
  for (const status of statuses) {
    const override = overrides?.[status]
    const builtin = BUILTIN_STATUS_PRESENTATION[status]
    if (builtin) {
      result[status] = override ?? builtin
      continue
    }
    // Every status the plugin doesn't recognise consumes the next palette
    // slot, whether or not it ends up overridden — the cursor must advance
    // identically with or without the override, or overriding one custom
    // status would shift the colours of every custom status declared after
    // it.
    const paletteColor = CUSTOM_STATUS_PALETTE[customIndex % CUSTOM_STATUS_PALETTE.length]
    customIndex += 1
    result[status] = override ?? paletteColor
  }
  return result
}

/**
 * Title-cases a raw status for display when no translation exists, e.g.
 * `awaiting-deposit` -> `Awaiting Deposit`. Splits on hyphens and underscores
 * so each word gets its own capital letter, rather than capitalising only the
 * first character of the whole string (which rendered as `Awaiting-deposit`).
 */
function titleCaseStatus(status: string): string {
  return status
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * `t` is widened to the minimal shape this function actually needs, rather than
 * the plugin's internal `PluginT` — `PluginT` is exported from no entry point,
 * so a consumer calling this from `payload-reserve/client` couldn't name it.
 */
export function buildStatusLabels(
  statuses: string[],
  t: (key: string) => string,
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const status of statuses) {
    const key = statusToI18nKey(status)
    const translated = t(key)
    // A missing translation returns the key itself — fall back to the raw status.
    labels[status] = translated !== key ? translated : titleCaseStatus(status)
  }
  return labels
}

/**
 * Builds the ACTION label for each status — the verb a button that
 * transitions TO this status should read (e.g. "Confirm" for `confirmed`),
 * as opposed to `buildStatusLabels`' noun/adjective label for the status
 * itself (e.g. "Confirmed").
 *
 * A status with no translated action falls back to its already-resolved
 * status label (translated, or title-cased raw status), never straight to
 * the raw status — `statusLabels` has already made that fallback decision.
 */
export function buildStatusActionLabels(
  statuses: string[],
  statusLabels: Record<string, string>,
  t: (key: string) => string,
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const status of statuses) {
    const key = statusToActionI18nKey(status)
    const translated = t(key)
    labels[status] = translated !== key ? translated : (statusLabels[status] ?? status)
  }
  return labels
}

import { extractId } from './resolveReservationItems.js'

export { extractId }

/**
 * Merge a primary set of resource ids with a service's required-resource ids,
 * deduping by string value and preserving first-seen order. Empty/undefined
 * values are dropped.
 */
export function mergeResourceIds(
  primary: Array<number | string | undefined>,
  required: Array<number | string | undefined>,
): Array<number | string> {
  const seen = new Set<string>()
  const out: Array<number | string> = []
  for (const id of [...primary, ...required]) {
    if (id === undefined || id === null || id === '') {
      continue
    }
    const key = String(id)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(id)
  }
  return out
}

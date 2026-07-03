type ResourceRef = { id?: number | string; name?: string } | null | number | string | undefined

const refId = (r: ResourceRef): number | string | undefined =>
  typeof r === 'object' && r !== null ? r.id : (r ?? undefined)

/** String-normalized id equality: Postgres installs serve numeric ids over REST
 * while `<select>` values (and the single-resource auto-select) are strings, so
 * strict `===` on the raw values silently never matches on Postgres. */
export const sameId = (a: null | number | string | undefined, b: null | number | string | undefined): boolean =>
  a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b)

/**
 * True when a reservation belongs to the selected resource — via its top-level
 * `resource` or any `items[].resource`. An empty selection matches everything.
 */
export function reservationMatchesResource(
  reservation: { items?: Array<{ resource?: ResourceRef }>; resource?: ResourceRef },
  selectedResourceId: string,
): boolean {
  if (!selectedResourceId) {
    return true
  }
  if (sameId(refId(reservation.resource), selectedResourceId)) {
    return true
  }
  return (reservation.items ?? []).some((item) => sameId(refId(item.resource), selectedResourceId))
}

/**
 * Build Payload select `options` from a list of string values.
 * Labels default to a capitalized form of the value.
 */
export function buildSelectOptions(
  values: string[],
): Array<{ label: string; value: string }> {
  return values.map((value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    value,
  }))
}

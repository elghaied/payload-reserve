type PayloadErrorEntry = {
  data?: { errors?: Array<{ message?: string; path?: string }> }
  message?: string
  name?: string
}

type PayloadErrorBody = {
  errors?: PayloadErrorEntry[]
}

const usable = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Pull the human-readable message out of a Payload REST error body.
 *
 * Payload wraps a hook-thrown `ValidationError` so that its own generic string
 * ("The following field is invalid: status") sits at `errors[0].message`, while
 * the message the hook actually wrote sits at `errors[0].data.errors[0].message`.
 * Reading the top level first would show the user nothing useful, so nested
 * messages win. See `payload/dist/utilities/formatErrors.js`.
 */
export function extractErrorMessage(body: unknown, fallback: string): string {
  const errors = (body as null | PayloadErrorBody | undefined)?.errors
  if (!Array.isArray(errors) || errors.length === 0) {
    return fallback
  }

  for (const entry of errors) {
    const nested = entry?.data?.errors
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (usable(item?.message)) {
          return item.message
        }
      }
    }
  }

  for (const entry of errors) {
    if (usable(entry?.message)) {
      return entry.message
    }
  }

  return fallback
}

import { ValidationError } from 'payload'

export type ResolvedItem = {
  endTime: string
  guestCount: number
  resource: string
  service?: string
  startTime: string
}

/**
 * Normalize reservation data into a list of resource-level items.
 *
 * - If items[] is populated -> return items (filling defaults from parent).
 *   Items missing startTime or resource throw a ValidationError.
 *   Duplicate (resource, startTime) pairs throw a ValidationError.
 * - If items[] is empty/absent -> return single item from top-level fields
 *
 * Every downstream function (conflict check, endTime calc, availability)
 * works with ResolvedItem[], never with raw reservation data.
 */
export function resolveReservationItems(data: Record<string, unknown>): ResolvedItem[] {
  const items = data.items as Array<Record<string, unknown>> | undefined

  if (items && items.length > 0) {
    const resolved: ResolvedItem[] = []
    const seen = new Set<string>()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const resource = extractId(item.resource) || extractId(data.resource) || ''
      const startTime = (item.startTime as string) ?? (data.startTime as string)

      if (!resource) {
        throw new ValidationError({
          errors: [
            {
              message: `Item ${i} is missing a resource`,
              path: `items.${i}.resource`,
            },
          ],
        })
      }

      if (!startTime) {
        throw new ValidationError({
          errors: [
            {
              message: `Item ${i} is missing a startTime`,
              path: `items.${i}.startTime`,
            },
          ],
        })
      }

      const key = `${resource}::${startTime}`
      if (seen.has(key)) {
        throw new ValidationError({
          errors: [
            {
              message: `Duplicate booking: item ${i} has the same resource and startTime as a previous item`,
              path: `items.${i}.startTime`,
            },
          ],
        })
      }
      seen.add(key)

      resolved.push({
        endTime: (item.endTime as string) ?? (data.endTime as string),
        guestCount: (item.guestCount as number) ?? (data.guestCount as number) ?? 1,
        resource,
        service: extractId(item.service) || extractId(data.service) || undefined,
        startTime,
      })
    }

    return resolved
  }

  // Single-resource fallback (current behavior)
  if (!data.resource || !data.startTime) {
    return []
  }

  return [
    {
      endTime: data.endTime as string,
      guestCount: (data.guestCount as number) ?? 1,
      resource: extractId(data.resource) || '',
      service: extractId(data.service) || undefined,
      startTime: data.startTime as string,
    },
  ]
}

function extractId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) {
    return value
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: string }).id
  }
  return undefined
}

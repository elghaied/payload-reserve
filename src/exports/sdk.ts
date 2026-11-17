/**
 * A small typed client for the plugin's public booking endpoints. It has no
 * dependency on Payload or React, so it runs in the browser, in a server
 * component, in React Native — anywhere `fetch` exists.
 *
 * ```ts
 * import { createReserveClient, ReserveError } from 'payload-reserve/sdk'
 *
 * const reserve = createReserveClient({ baseURL: 'https://example.com' })
 * const { slots } = await reserve.getSlots({ date: '2026-06-01', resource, service })
 * ```
 */
import type { EmptyReason } from '../services/AvailabilityService.js'
import type { HoldRefusalReason } from '../services/HoldService.js'

import { extractErrorMessage } from '../utilities/extractErrorMessage.js'

type Id = number | string
type DateInput = Date | string

export type ReserveClientOptions = {
  /** Payload's API route. Default `/api`. */
  apiRoute?: string
  /** Origin of the Payload app, e.g. `https://example.com`. Default: same origin. */
  baseURL?: string
  /** Default `include`, so a signed-in customer's cookie is sent. */
  credentials?: RequestCredentials
  /** A `fetch` implementation. Default: the global one. */
  fetch?: typeof fetch
  /** Extra headers on every request, e.g. `Authorization`. */
  headers?: Record<string, string>
}

export type ReserveSlot = { end: string; start: string }

export type GetSlotsParams = {
  /** A `YYYY-MM-DD` day in the business timezone, or a `Date`. */
  date: DateInput
  guestCount?: number
  resource: Id
  /** Extra resources that must all be free (multi-resource bookings). */
  resources?: Id[]
  service: Id
}

export type GetSlotsResult = {
  date: string
  guestCount: number
  /** Why `slots` is empty. Absent when there are slots. */
  reason?: EmptyReason
  slots: ReserveSlot[]
}

export type HoldParams = {
  /** Required for a `flexible`-duration service. */
  endTime?: DateInput
  guestCount?: number
  resource: Id
  service: Id
  startTime: DateInput
}

export type HoldResult = { expiresAt: string; token: string }

export type BookParams = {
  /** Staff only. A signed-in customer always books for themselves. */
  customer?: Id
  endTime?: DateInput
  /** For a booking without an account. */
  guest?: { email?: string; name: string; phone?: string }
  guestCount?: number
  /** The token from `hold()`, to convert that hold into this booking. */
  holdToken?: string
  /** Makes a retried submit safe: a reused key is rejected, not booked twice. */
  idempotencyKey?: string
  items?: Array<{
    endTime?: DateInput
    guestCount?: number
    resource: Id
    service?: Id
    startTime?: DateInput
  }>
  notes?: string
  resource: Id
  service: Id
  startTime: DateInput
} & Record<string, unknown>

export type CancelParams = {
  reason?: string
  reservationId: Id
  /** A guest's cancellation token. Not needed for a signed-in owner or staff. */
  token?: string
}

/** A reservation document as the endpoints return it (relationships as ids). */
export type ReserveReservation = {
  endTime?: string
  id: Id
  startTime: string
  status: string
} & Record<string, unknown>

/** Machine-readable error codes the endpoints can return in `error`. */
export type ReserveErrorCode = HoldRefusalReason

/**
 * Thrown for every non-2xx response. `message` is safe to show to a user;
 * branch on `status`, `code` and `retryable`.
 */
export class ReserveError extends Error {
  /** The parsed response body, for anything not surfaced above. */
  body: unknown
  /** A machine-readable code such as `slot_taken`, when the endpoint sends one. */
  code?: ReserveErrorCode
  /** Extra explanation that accompanies some codes (`invalid_window`, `hold_limit_reached`). */
  detail?: string
  /** The field a validation error points at, e.g. `startTime` or `items.1.resource`. */
  path?: string
  /** True when the request lost a race and can simply be sent again. */
  retryable: boolean
  status: number

  constructor(status: number, body: unknown) {
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const raw =
      typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : undefined
    super(raw ?? extractErrorMessage(body, `Request failed (${status})`))
    this.name = 'ReserveError'
    this.status = status
    this.body = body
    this.retryable = record.retryable === true
    if (raw && /^[a-z]+(?:_[a-z]+)+$/.test(raw)) {
      this.code = raw as ReserveErrorCode
    }
    if (typeof record.detail === 'string') {
      this.detail = record.detail
    }
    const nested = (record.errors as Array<{ data?: { errors?: Array<{ path?: string }> } }>)?.[0]
      ?.data?.errors?.[0]?.path
    if (typeof nested === 'string') {
      this.path = nested
    }
  }
}

const iso = (value: DateInput | undefined): string | undefined =>
  value instanceof Date ? value.toISOString() : value

/** A `Date` becomes its UTC calendar day; pass a `YYYY-MM-DD` string to be exact. */
const dayKey = (value: DateInput): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value

export type ReserveClient = {
  /** Book a slot. Throws `ReserveError` (409 when the slot is taken). */
  book: (params: BookParams) => Promise<ReserveReservation>
  /** Cancel a booking as its owner, as staff, or as a guest with `token`. */
  cancel: (params: CancelParams) => Promise<ReserveReservation>
  /** Free slots for a service on a resource on one day. */
  getSlots: (params: GetSlotsParams) => Promise<GetSlotsResult>
  /** Hold a slot during checkout. Needs the `slotHolds` plugin option. */
  hold: (params: HoldParams) => Promise<HoldResult>
  /** Release a hold. Safe to call twice. */
  releaseHold: (token: string) => Promise<{ released: number }>
}

export function createReserveClient(options: ReserveClientOptions = {}): ReserveClient {
  const base = `${(options.baseURL ?? '').replace(/\/$/, '')}${options.apiRoute ?? '/api'}`
  const doFetch = options.fetch ?? fetch

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await doFetch(`${base}${path}`, {
      credentials: options.credentials ?? 'include',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ReserveError(response.status, body)
    }
    return body as T
  }

  const post = <T>(path: string, data: unknown) =>
    request<T>(path, { body: JSON.stringify(data), method: 'POST' })

  return {
    book: ({ endTime, items, startTime, ...rest }) =>
      post('/reserve/book', {
        ...rest,
        ...(endTime ? { endTime: iso(endTime) } : {}),
        ...(items
          ? {
              items: items.map((item) => ({
                ...item,
                ...(item.endTime ? { endTime: iso(item.endTime) } : {}),
                ...(item.startTime ? { startTime: iso(item.startTime) } : {}),
              })),
            }
          : {}),
        startTime: iso(startTime),
      }),
    cancel: (params) => post('/reserve/cancel', params),
    getSlots: ({ date, guestCount, resource, resources, service }) => {
      const query = new URLSearchParams({
        date: dayKey(date),
        resource: String(resource),
        service: String(service),
      })
      if (guestCount !== undefined) {
        query.set('guestCount', String(guestCount))
      }
      if (resources?.length) {
        query.set('resources', resources.join(','))
      }
      return request(`/reserve/slots?${query}`)
    },
    hold: ({ endTime, startTime, ...rest }) =>
      post('/reserve/hold', {
        ...rest,
        ...(endTime ? { endTime: iso(endTime) } : {}),
        startTime: iso(startTime),
      }),
    releaseHold: (token) => post('/reserve/hold/release', { token }),
  }
}

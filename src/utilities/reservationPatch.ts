import { extractErrorMessage } from './extractErrorMessage.js'

export type MutationResult = {
  /** Ready to display: the server's own message on failure, a success string otherwise. */
  message: string
  ok: boolean
}

/**
 * PATCH a reservation and turn the response into a ready-to-display `MutationResult`.
 *
 * Split out of `useReservationMutations` (`src/components/hooks/useReservationMutations.ts`)
 * as a plain, injectable-`fetch` function so the request/response handling — success, a
 * nested Payload `ValidationError` message, a non-JSON error body, a network failure — is
 * unit-testable without a React renderer (this repo has none) and without importing
 * `@payloadcms/ui`, which pulls in a `.css` import that Vitest's `node` environment cannot
 * load. See `dev/reservationMutations.spec.ts`. The hook is a thin binding over this: it
 * supplies the URL, the translated messages, and the global `fetch`.
 */
export async function performReservationPatch(args: {
  data: Record<string, unknown>
  fetchImpl: typeof fetch
  messages: { failure: string; network: string; success: string }
  url: string
}): Promise<MutationResult> {
  const { data, fetchImpl, messages, url } = args

  let response: Response
  try {
    response = await fetchImpl(url, {
      body: JSON.stringify(data),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
  } catch {
    return { message: messages.network, ok: false }
  }

  if (response.ok) {
    return { message: messages.success, ok: true }
  }

  // A non-JSON error body (a proxy 502, say) must not throw here.
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  return {
    message: extractErrorMessage(body, messages.failure),
    ok: false,
  }
}

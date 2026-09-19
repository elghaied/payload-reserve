'use client'
import { useWindowInfo } from '@payloadcms/ui'

/**
 * Whether the admin viewport is a phone, per Payload's own `s` breakpoint
 * (`max-width: 768px` — the width at which the admin nav collapses), so the
 * calendar never disagrees with the shell around it.
 *
 * `viewportKnown` is false until `WindowInfoProvider` has measured once
 * (`eventsFired === 0` on the first client render, where `breakpoints` is
 * still `{}`); consumers that must act exactly once on the real viewport
 * gate on it. Outside a provider (component tests, a consumer rendering
 * `payload-reserve/client` components on its own) the context is `{}`, so
 * every read is optional.
 */
export function useIsMobile(): { isMobile: boolean; viewportKnown: boolean } {
  const info = useWindowInfo() as
    | { breakpoints?: Record<string, boolean>; eventsFired?: number }
    | undefined
  return {
    isMobile: info?.breakpoints?.s === true,
    viewportKnown: (info?.eventsFired ?? 0) > 0,
  }
}

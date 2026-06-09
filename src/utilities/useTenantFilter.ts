'use client'
import { useConfig } from '@payloadcms/ui'
import { useMemo } from 'react'

import { collectionHasTenantField, readCookie, tenantQueryParams } from './tenantFilter.js'

/**
 * REST query params scoping a collection's fetch to the selected tenant.
 * Returns `{}` when the collection has no tenant field or no tenant cookie is set,
 * so single-tenant installs build identical URLs to before.
 */
export function useTenantFilter(collectionSlug: string): Record<string, string> {
  const { config } = useConfig()
  const tenantConfig =
    (config.admin?.custom?.reservationTenant as
      | { cookieName?: string; tenantField?: string }
      | undefined) ?? {}
  const cookieName = tenantConfig.cookieName ?? 'payload-tenant'
  const tenantField = tenantConfig.tenantField ?? 'tenant'
  const collection = config.collections?.find((c) => c.slug === collectionSlug)
  const hasField = collectionHasTenantField(collection as { fields?: unknown[] } | undefined, tenantField)
  const tenantId = typeof document !== 'undefined' ? readCookie(document.cookie, cookieName) : null

  return useMemo(
    () => tenantQueryParams({ hasField, tenantField, tenantId }),
    [hasField, tenantField, tenantId],
  )
}

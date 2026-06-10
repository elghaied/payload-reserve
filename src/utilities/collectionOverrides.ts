import type { CollectionConfig } from 'payload'

import type { CollectionOverride } from '../types.js'

import { composeAccess } from './ownerAccess.js'

/**
 * Apply a per-collection override to a generated collection, protecting the
 * plugin's load-bearing behavior:
 * - `fields`: a function receiving the plugin's default fields, returning the
 *   final list (append/reorder/replace — covers the issue #4 join-field case).
 * - `hooks`: MERGED per event array (plugin hooks run first, then the user's) —
 *   an override can add hooks but never clobber conflict detection / status hooks.
 * - `access`: composed per operation (rules the override omits survive).
 * - `slug`: ignored (the `slugs` option owns slugs).
 * - everything else (admin, labels, custom, …): shallow-merged.
 */
export function applyCollectionOverride(
  collection: CollectionConfig,
  override?: CollectionOverride,
): CollectionConfig {
  if (!override) {
    return collection
  }

  // Pull out the specially-handled keys; the rest shallow-merges. `slug` is
  // omitted from CollectionOverride's type, but strip it defensively in case a
  // caller cast around the type — the `slugs` option owns slugs.
  const { access, fields, hooks, ...rest } = override
  delete (rest as { slug?: unknown }).slug

  const mergedFields = fields ? fields({ defaultFields: collection.fields }) : collection.fields

  // Merge hooks per event array: plugin's first, then the override's.
  const mergedHooks: CollectionConfig['hooks'] = { ...collection.hooks }
  if (hooks) {
    for (const key of Object.keys(hooks) as Array<keyof NonNullable<CollectionConfig['hooks']>>) {
      const pluginHooks = (collection.hooks?.[key] ?? []) as unknown[]
      const overrideHooks = (hooks[key] ?? []) as unknown[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mergedHooks as any)[key] = [...pluginHooks, ...overrideHooks]
    }
  }

  return {
    ...collection,
    ...rest,
    access: composeAccess(collection.access ?? {}, access),
    fields: mergedFields,
    hooks: mergedHooks,
  }
}

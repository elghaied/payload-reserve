import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { testDbUri } from './testDbUri.js'

/**
 * Pure URL-rewrite logic — no Mongo needed. Exercises the `MEMORY_DB_URI`-present
 * branch directly against a fake replica-set URI shaped exactly like
 * `MongoMemoryReplSet#getUri()`'s real output (`mongodb://host/?replicaSet=name`),
 * so a regression back to naive string concatenation (which silently points every
 * suite at the same, wrong database) fails here instead of surfacing as a
 * hard-to-diagnose cross-suite data collision.
 */
describe('testDbUri', () => {
  const originalMemoryDbUri = process.env.MEMORY_DB_URI

  beforeEach(() => {
    process.env.MEMORY_DB_URI = 'mongodb://127.0.0.1:12345/?replicaSet=testset'
  })

  afterEach(() => {
    if (originalMemoryDbUri === undefined) {
      delete process.env.MEMORY_DB_URI
    } else {
      process.env.MEMORY_DB_URI = originalMemoryDbUri
    }
  })

  test('two distinct dbNames produce two distinct pathnames', async () => {
    const foo = await testDbUri('foomemory')
    const bar = await testDbUri('barmemory')

    expect(new URL(foo.uri).pathname).toBe('/foomemory')
    expect(new URL(bar.uri).pathname).toBe('/barmemory')
    expect(foo.uri).not.toBe(bar.uri)
  })

  test('an existing query string survives the rewrite', async () => {
    const { uri } = await testDbUri('quxmemory')
    const url = new URL(uri)

    expect(url.searchParams.get('replicaSet')).toBe('testset')
    expect(url.searchParams.get('retryWrites')).toBe('true')
  })

  test('stop is a no-op when the shared cluster is used', async () => {
    const { stop } = await testDbUri('noopmemory')

    await expect(stop()).resolves.toBeUndefined()
  })
})

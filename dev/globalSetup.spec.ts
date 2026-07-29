import { describe, expect, test } from 'vitest'

describe('shared test database', () => {
  test('globalSetup exposes one replica-set URI to every worker, unless PG_URL or SQLITE opts out of Mongo', () => {
    // Under PG_URL or SQLITE, dev/globalSetup.ts deliberately skips starting Mongo at
    // all — asserting MEMORY_DB_URI unconditionally would fail every such run, not
    // just pass vacuously. Branching here (rather than skipping the test under
    // PG_URL/SQLITE) keeps this file's own guarantee — "no Mongo when a non-Mongo
    // harness is selected" — checked in every mode instead of going untested in one
    // of them.
    if (process.env.PG_URL || process.env.SQLITE) {
      expect(process.env.MEMORY_DB_URI).toBeUndefined()
      return
    }

    expect(process.env.MEMORY_DB_URI).toBeDefined()
    expect(process.env.MEMORY_DB_URI).toMatch(/^mongodb:\/\//)
  })
})

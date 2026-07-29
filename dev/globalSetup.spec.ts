import { describe, expect, test } from 'vitest'

describe('shared test database', () => {
  test('globalSetup exposes one replica-set URI to every worker, unless PG_URL opts out of Mongo', () => {
    // Under PG_URL, dev/globalSetup.ts deliberately skips starting Mongo at all —
    // asserting MEMORY_DB_URI unconditionally would fail every PG_URL run, not just
    // pass vacuously. Branching here (rather than skipping the test under PG_URL)
    // keeps this file's own guarantee — "no Mongo when PG_URL is set" — checked in
    // both modes instead of going untested in one of them.
    if (process.env.PG_URL) {
      expect(process.env.MEMORY_DB_URI).toBeUndefined()
      return
    }

    expect(process.env.MEMORY_DB_URI).toBeDefined()
    expect(process.env.MEMORY_DB_URI).toMatch(/^mongodb:\/\//)
  })
})

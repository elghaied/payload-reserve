import { describe, expect, test } from 'vitest'

describe('shared test database', () => {
  test('globalSetup exposes one replica-set URI to every worker', () => {
    expect(process.env.MEMORY_DB_URI).toBeDefined()
    expect(process.env.MEMORY_DB_URI).toMatch(/^mongodb:\/\//)
  })
})

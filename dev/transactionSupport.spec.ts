import { describe, expect, test } from 'vitest'

import { supportsTransactions } from '../src/utilities/transactionSupport.js'

describe('supportsTransactions', () => {
  test('true when the adapter exposes a usable beginTransaction', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const payload = { db: { beginTransaction: async () => 'txn-1' } }
    expect(await supportsTransactions(payload as never)).toBe(true)
  })

  test("false when beginTransaction returns null (Payload's no-transaction signal)", async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const payload = { db: { beginTransaction: async () => null } }
    expect(await supportsTransactions(payload as never)).toBe(false)
  })

  test('false when the adapter has no beginTransaction at all', async () => {
    expect(await supportsTransactions({ db: {} } as never)).toBe(false)
  })

  test('false rather than throwing when beginTransaction rejects', async () => {
    const payload = {
      db: {
        // eslint-disable-next-line @typescript-eslint/require-await
        beginTransaction: async () => {
          throw new Error('not a replica set')
        },
      },
    }
    expect(await supportsTransactions(payload as never)).toBe(false)
  })
})

import type { Config, Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import { payloadReserve } from '../src/index.js'

type Warned = { messages: string[]; payload: Payload }

function fakePayload(collections: Array<Record<string, unknown>>): Warned {
  const messages: string[] = []
  const payload = {
    // A transactional stub so this file's D5 assertions aren't polluted by the
    // unrelated no-transactions diagnostic (see transactionSupport.spec.ts for
    // that check in isolation).
    config: { collections },
    // eslint-disable-next-line @typescript-eslint/require-await
    db: { beginTransaction: async () => 'txn-1' },
    logger: {
      warn: (msg: string) => {
        messages.push(msg)
      },
    },
  } as unknown as Payload
  return { messages, payload }
}

const baseConfig = (): Config =>
  ({ collections: [], endpoints: [] }) as unknown as Config

describe('D5: reservationDetail with calendarView replaced or disabled', () => {
  it('warns when both are custom strings', async () => {
    const { messages, payload } = fakePayload([])
    const config = payloadReserve({
      components: { calendarView: 'my-app#MyCalendar', reservationDetail: '/d.tsx#D' },
    })(baseConfig())
    await config.onInit!(payload)
    expect(messages.join('\n')).toContain('components.reservationDetail is set')
  })

  it('warns when calendarView is false (Payload’s stock list view never renders the detail slot)', async () => {
    const { messages, payload } = fakePayload([])
    const config = payloadReserve({
      components: { calendarView: false, reservationDetail: '/d.tsx#D' },
    })(baseConfig())
    await config.onInit!(payload)
    expect(messages.join('\n')).toContain('components.reservationDetail is set')
  })

  it('does not warn when only reservationDetail is set', async () => {
    const { messages, payload } = fakePayload([])
    const config = payloadReserve({
      components: { reservationDetail: '/d.tsx#D' },
    })(baseConfig())
    await config.onInit!(payload)
    expect(messages.join('\n')).not.toContain('components.reservationDetail is set')
  })

  it('does not warn when only calendarView is set', async () => {
    const { messages, payload } = fakePayload([])
    const config = payloadReserve({
      components: { calendarView: 'my-app#MyCalendar' },
    })(baseConfig())
    await config.onInit!(payload)
    expect(messages.join('\n')).not.toContain('components.reservationDetail is set')
  })
})

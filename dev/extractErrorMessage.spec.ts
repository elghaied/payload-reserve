import { describe, expect, it } from 'vitest'

import { extractErrorMessage } from '../src/utilities/extractErrorMessage.js'

const FALLBACK = 'Something went wrong.'

describe('extractErrorMessage', () => {
  it('prefers the nested hook message over Payload’s generic wrapper', () => {
    const body = {
      errors: [
        {
          name: 'ValidationError',
          data: {
            errors: [
              { message: 'You must cancel at least 24 hours in advance.', path: 'status' },
            ],
          },
          message: 'The following field is invalid: status',
        },
      ],
    }
    expect(extractErrorMessage(body, FALLBACK)).toBe(
      'You must cancel at least 24 hours in advance.',
    )
  })

  it('falls back to the top-level message when there is no nested one', () => {
    const body = { errors: [{ message: 'You are not allowed to perform this action.' }] }
    expect(extractErrorMessage(body, FALLBACK)).toBe(
      'You are not allowed to perform this action.',
    )
  })

  it('skips blank nested messages', () => {
    const body = {
      errors: [{ data: { errors: [{ message: '   ' }] }, message: 'Top level wins' }],
    }
    expect(extractErrorMessage(body, FALLBACK)).toBe('Top level wins')
  })

  it('returns the fallback for an empty, malformed, or non-object body', () => {
    expect(extractErrorMessage({ errors: [] }, FALLBACK)).toBe(FALLBACK)
    expect(extractErrorMessage({}, FALLBACK)).toBe(FALLBACK)
    expect(extractErrorMessage(null, FALLBACK)).toBe(FALLBACK)
    expect(extractErrorMessage('not json', FALLBACK)).toBe(FALLBACK)
  })

  it('reads the first usable nested message across multiple errors', () => {
    const body = {
      errors: [
        { message: 'wrapper one' },
        { data: { errors: [{ message: 'second error is the real one' }] } },
      ],
    }
    expect(extractErrorMessage(body, FALLBACK)).toBe('second error is the real one')
  })
})

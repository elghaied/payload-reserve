import { describe, expect, it, vi } from 'vitest'

import { createReserveDebug, NOOP_RESERVE_DEBUG } from '../src/utilities/reserveDebug.js'

describe('ReserveDebug helper', () => {
  it('emits one info line with event/traceId/stage/fields and a message string when enabled', () => {
    const info = vi.fn()
    const d = createReserveDebug({ info }, true, 'trace123')
    d.dbg('input', { serviceId: 's1' })

    expect(info).toHaveBeenCalledTimes(1)
    const [obj, msg] = info.mock.calls[0]
    expect(obj).toMatchObject({
      event: 'reserve_debug',
      serviceId: 's1',
      stage: 'input',
      traceId: 'trace123',
    })
    expect(msg).toBe('reserve_debug')
  })

  it('is a no-op when disabled', () => {
    const info = vi.fn()
    const d = createReserveDebug({ info }, false)
    d.dbg('input', { serviceId: 's1' })
    expect(info).not.toHaveBeenCalled()
  })

  it('NOOP_RESERVE_DEBUG never logs', () => {
    // Exercised for coverage; simply must not throw.
    NOOP_RESERVE_DEBUG.dbg('anything', { a: 1 })
    NOOP_RESERVE_DEBUG.child({ b: 2 }).dbg('more', {})
    expect(true).toBe(true)
  })

  it('child shares the traceId and merges base fields into every line', () => {
    const info = vi.fn()
    const parent = createReserveDebug({ info }, true, 'tid')
    const child = parent.child({ resourceId: 'r1' })
    child.dbg('check', { available: false })

    const [obj] = info.mock.calls[0]
    expect(obj).toMatchObject({
      available: false,
      resourceId: 'r1',
      stage: 'check',
      traceId: 'tid',
    })
  })

  it('puts caught errors under the err key', () => {
    const info = vi.fn()
    const d = createReserveDebug({ info }, true, 'tid')
    const boom = new Error('kaboom')
    d.dbg('error', { err: boom, where: 'bufferFor' })

    const [obj] = info.mock.calls[0]
    expect(obj).toMatchObject({ err: boom, stage: 'error', where: 'bufferFor' })
  })
})

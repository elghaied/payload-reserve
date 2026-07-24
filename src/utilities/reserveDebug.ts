/** Structured fields attached to one debug line. */
export type ReserveDebugFields = Record<string, unknown>

/** Minimal logger surface — Payload's Pino `logger.info(obj, msg?)`. */
type DebugLogger = { info: (obj: unknown, msg?: string) => void }

export type ReserveDebug = {
  /** New instance, same traceId, merging baseFields into every subsequent line. */
  child: (baseFields: ReserveDebugFields) => ReserveDebug
  /** Emit one trace line (no-op when disabled). */
  dbg: (stage: string, fields?: ReserveDebugFields) => void
  enabled: boolean
  traceId: string
}

/**
 * Create a debug tracer. When `enabled`, every `dbg(stage, fields)` emits a
 * single Pino line:
 * `logger.info({ event: 'reserve_debug', traceId, stage, ...base, ...fields }, 'reserve_debug')`.
 * When disabled, `dbg` is an immediate no-op. Emitting at INFO is deliberate:
 * the opt-in flag is the gate, so traces survive Pino's default info level in
 * production (a `.debug()` line would be silently dropped there).
 */
export function createReserveDebug(
  logger: DebugLogger,
  enabled: boolean,
  traceId?: string,
  baseFields: ReserveDebugFields = {},
): ReserveDebug {
  const id = traceId ?? Math.random().toString(36).slice(2, 10)
  return {
    child: (extra) => createReserveDebug(logger, enabled, id, { ...baseFields, ...extra }),
    dbg: (stage, fields = {}) => {
      if (!enabled) {
        return
      }
      logger.info(
        { event: 'reserve_debug', stage, traceId: id, ...baseFields, ...fields },
        'reserve_debug',
      )
    },
    enabled,
    traceId: id,
  }
}

/** Shared disabled tracer — the default for functions whose `debug` param is omitted. */
export const NOOP_RESERVE_DEBUG: ReserveDebug = createReserveDebug({ info: () => {} }, false)

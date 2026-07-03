import type { ExternalBusyInterval, GetExternalBusy } from '../../src/types.js'

/** Test-controlled state for the dev app's getExternalBusy resolver. */
export const externalBusyState: { intervals: ExternalBusyInterval[]; throwError: boolean } = {
  intervals: [],
  throwError: false,
}

export const externalBusyResolver: GetExternalBusy = () => {
  if (externalBusyState.throwError) {
    return Promise.reject(new Error('resolver boom'))
  }
  return Promise.resolve(externalBusyState.intervals)
}

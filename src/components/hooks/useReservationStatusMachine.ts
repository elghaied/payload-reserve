'use client'
import { useConfig, useTranslation } from '@payloadcms/ui'
import { useMemo } from 'react'

import type { PluginT } from '../../translations/index.js'
import type { PartialStatusMachine } from '../../utilities/statusMachineFallback.js'
import type { StatusPresentation } from '../../utilities/statusPresentation.js'

import { deriveCancelConfirm } from '../../utilities/statusMachineFallback.js'
import {
  buildStatusLabels,
  buildStatusPresentation,
  BUILTIN_STATUSES,
} from '../../utilities/statusPresentation.js'

export type ReservationStatusMachine = {
  cancelStatus: string
  confirmStatus: string
  defaultStatus: string
  labels: Record<string, string>
  presentation: Record<string, StatusPresentation>
  statuses: string[]
  /** Statuses reachable from `status`, per the configured transition map. */
  transitionsFrom: (status: string) => string[]
}

/**
 * Read the plugin's resolved status machine out of admin config, along with the
 * derived labels and colours every status-aware component needs.
 */
export function useReservationStatusMachine(): ReservationStatusMachine {
  const { config } = useConfig()
  const { t: _t } = useTranslation()
  const t = _t as PluginT

  const machine = (config.admin?.custom as Record<string, unknown> | undefined)
    ?.reservationStatusMachine as PartialStatusMachine | undefined

  return useMemo(() => {
    const statuses = machine?.statuses ?? BUILTIN_STATUSES
    const defaultStatus = machine?.defaultStatus ?? 'pending'
    const { cancelStatus, confirmStatus } = deriveCancelConfirm(machine, defaultStatus)
    const transitions = machine?.transitions ?? {}

    return {
      cancelStatus,
      confirmStatus,
      defaultStatus,
      labels: buildStatusLabels(statuses, t),
      presentation: buildStatusPresentation(statuses),
      statuses,
      transitionsFrom: (status: string) => transitions[status] ?? [],
    }
    // `t` is stable per language; `machine` comes from static admin config.
  }, [machine, t])
}

export type PartialStatusMachine = {
  cancelStatus?: string
  confirmStatus?: string
  defaultStatus?: string
  statuses?: string[]
  terminalStatuses?: string[]
  transitions?: Record<string, string[]>
}

/**
 * Resolve the cancel and confirm target statuses.
 *
 * The resolved plugin config carries these explicitly, so they are used when
 * present. The transition-shape heuristic below is a fallback for an admin
 * config written before those fields existed; it can choose wrongly for a custom
 * vocabulary, which is why it never overrides an explicit value.
 */
export function deriveCancelConfirm(
  machine: PartialStatusMachine | undefined,
  defaultStatus: string,
): { cancelStatus: string; confirmStatus: string } {
  const terminalStatuses = machine?.terminalStatuses ?? ['completed', 'cancelled', 'no-show']
  const outgoing = machine?.transitions?.[defaultStatus] ?? []

  const derivedConfirm = outgoing.find((s) => !terminalStatuses.includes(s))
  const derivedCancel = outgoing.find((s) => terminalStatuses.includes(s))

  return {
    cancelStatus: machine?.cancelStatus ?? derivedCancel ?? 'cancelled',
    confirmStatus: machine?.confirmStatus ?? derivedConfirm ?? 'confirmed',
  }
}

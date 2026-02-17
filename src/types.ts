import type { CollectionConfig, PayloadRequest } from 'payload'

// --- Duration & Capacity models ---

export type DurationType = 'fixed' | 'flexible' | 'full-day'

export type CapacityMode = 'per-guest' | 'per-reservation'

// --- Configurable status machine ---

export type StatusMachineConfig = {
  blockingStatuses: string[]
  defaultStatus: string
  statuses: string[]
  terminalStatuses: string[]
  transitions: Record<string, string[]>
}

export const DEFAULT_STATUS_MACHINE: StatusMachineConfig = {
  blockingStatuses: ['pending', 'confirmed'],
  defaultStatus: 'pending',
  statuses: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
  terminalStatuses: ['completed', 'cancelled', 'no-show'],
  transitions: {
    cancelled: [],
    completed: [],
    confirmed: ['completed', 'cancelled', 'no-show'],
    'no-show': [],
    pending: ['confirmed', 'cancelled'],
  },
}

// --- Reservation item (for multi-resource bookings, Phase 3) ---

export type ReservationItemConfig = {
  endTime?: string
  guestCount?: number
  resource: string
  service?: string
  startTime?: string
}

// --- Plugin hooks for external integrations ---

export type ReservationPluginHooks = {
  afterBookingCancel?: Array<
    (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
  >
  afterBookingConfirm?: Array<
    (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
  >
  afterBookingCreate?: Array<
    (args: { doc: Record<string, unknown>; req: PayloadRequest }) => Promise<void> | void
  >
  afterStatusChange?: Array<
    (args: {
      doc: Record<string, unknown>
      newStatus: string
      previousStatus: string
      req: PayloadRequest
    }) => Promise<void> | void
  >
  beforeBookingCancel?: Array<
    (args: {
      doc: Record<string, unknown>
      reason?: string
      req: PayloadRequest
    }) => Promise<void> | void
  >
  beforeBookingConfirm?: Array<
    (args: {
      doc: Record<string, unknown>
      newStatus: string
      req: PayloadRequest
    }) => Promise<void> | void
  >
  beforeBookingCreate?: Array<
    (args: {
      data: Record<string, unknown>
      req: PayloadRequest
    }) => Promise<Record<string, unknown>> | Record<string, unknown>
  >
}

// --- Plugin configuration ---

export type ReservationPluginConfig = {
  /** Override access control per collection */
  access?: {
    customers?: CollectionConfig['access']
    reservations?: CollectionConfig['access']
    resources?: CollectionConfig['access']
    schedules?: CollectionConfig['access']
    services?: CollectionConfig['access']
  }
  /** Admin group name for all reservation collections */
  adminGroup?: string
  /** Hours of notice required before cancellation */
  cancellationNoticePeriod?: number
  /** Default buffer time in minutes between reservations */
  defaultBufferTime?: number
  /** Disable the plugin entirely */
  disabled?: boolean
  /** Plugin hooks for external integrations */
  hooks?: ReservationPluginHooks
  /** Override collection slugs */
  slugs?: {
    customers?: string
    media?: string
    reservations?: string
    resources?: string
    schedules?: string
    services?: string
  }
  /** Configurable status machine (defaults to current behavior) */
  statusMachine?: Partial<StatusMachineConfig>
  /** Which existing auth collection to extend with customer fields */
  userCollection?: string
}

export type ResolvedReservationPluginConfig = {
  access: {
    customers?: CollectionConfig['access']
    reservations?: CollectionConfig['access']
    resources?: CollectionConfig['access']
    schedules?: CollectionConfig['access']
    services?: CollectionConfig['access']
  }
  adminGroup: string
  cancellationNoticePeriod: number
  defaultBufferTime: number
  disabled: boolean
  hooks: ReservationPluginHooks
  localized: boolean
  slugs: {
    customers: string
    media: string
    reservations: string
    resources: string
    schedules: string
    services: string
  }
  statusMachine: StatusMachineConfig
  userCollection: string | undefined
}

export type ReservationStatus = 'cancelled' | 'completed' | 'confirmed' | 'no-show' | 'pending'

export type DayOfWeek = 'fri' | 'mon' | 'sat' | 'sun' | 'thu' | 'tue' | 'wed'

export type ScheduleType = 'manual' | 'recurring'

/** @deprecated Use DEFAULT_STATUS_MACHINE.transitions instead */
export const VALID_STATUS_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> =
  DEFAULT_STATUS_MACHINE.transitions as Record<ReservationStatus, ReservationStatus[]>

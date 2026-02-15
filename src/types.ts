import type { CollectionConfig } from 'payload'

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
  /** Override collection slugs */
  slugs?: {
    customers?: string
    media?: string
    reservations?: string
    resources?: string
    schedules?: string
    services?: string
  }
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
  localized: boolean
  slugs: {
    customers: string
    media: string
    reservations: string
    resources: string
    schedules: string
    services: string
  }
}

export type ReservationStatus = 'cancelled' | 'completed' | 'confirmed' | 'no-show' | 'pending'

export type DayOfWeek = 'fri' | 'mon' | 'sat' | 'sun' | 'thu' | 'tue' | 'wed'

export type ScheduleType = 'manual' | 'recurring'

export const VALID_STATUS_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  cancelled: [],
  completed: [],
  confirmed: ['completed', 'cancelled', 'no-show'],
  'no-show': [],
  pending: ['confirmed', 'cancelled'],
}

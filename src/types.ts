import type { CollectionConfig } from 'payload'

export type ReservationPluginConfig = {
  /** Override access control per collection */
  access?: {
    reservations?: CollectionConfig['access']
    resources?: CollectionConfig['access']
    schedules?: CollectionConfig['access']
    services?: CollectionConfig['access']
  }
  /** Admin group name for all reservation collections */
  adminGroup?: string
  /** Hours of notice required before cancellation */
  cancellationNoticePeriod?: number
  /** Role to filter customers by in the reservation form. Set false to disable filtering. (default: 'customer') */
  customerRole?: false | string
  /** Default buffer time in minutes between reservations */
  defaultBufferTime?: number
  /** Disable the plugin entirely */
  disabled?: boolean
  /** Override collection slugs */
  slugs?: {
    media?: string
    reservations?: string
    resources?: string
    schedules?: string
    services?: string
  }
  /** Slug of the existing auth collection to extend with customer fields (default: 'users') */
  userCollection?: string
}

export type ResolvedReservationPluginConfig = {
  access: {
    reservations?: CollectionConfig['access']
    resources?: CollectionConfig['access']
    schedules?: CollectionConfig['access']
    services?: CollectionConfig['access']
  }
  adminGroup: string
  cancellationNoticePeriod: number
  customerRole: false | string
  defaultBufferTime: number
  disabled: boolean
  localized: boolean
  slugs: {
    media: string
    reservations: string
    resources: string
    schedules: string
    services: string
  }
  userCollection: string
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

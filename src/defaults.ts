import type { ReservationPluginConfig, ResolvedReservationPluginConfig } from './types.js'

export const DEFAULT_SLUGS = {
  reservations: 'reservations',
  resources: 'reservation-resources',
  schedules: 'reservation-schedules',
  services: 'reservation-services',
} as const

export const DEFAULT_ADMIN_GROUP = 'Reservations'
export const DEFAULT_BUFFER_TIME = 0
export const DEFAULT_CANCELLATION_NOTICE_PERIOD = 24
export const DEFAULT_USER_COLLECTION = 'users'

export function resolveConfig(
  pluginOptions: ReservationPluginConfig,
): ResolvedReservationPluginConfig {
  return {
    access: pluginOptions.access ?? {},
    adminGroup: pluginOptions.adminGroup ?? DEFAULT_ADMIN_GROUP,
    cancellationNoticePeriod:
      pluginOptions.cancellationNoticePeriod ?? DEFAULT_CANCELLATION_NOTICE_PERIOD,
    defaultBufferTime: pluginOptions.defaultBufferTime ?? DEFAULT_BUFFER_TIME,
    disabled: pluginOptions.disabled ?? false,
    localized: false,
    slugs: {
      reservations: pluginOptions.slugs?.reservations ?? DEFAULT_SLUGS.reservations,
      resources: pluginOptions.slugs?.resources ?? DEFAULT_SLUGS.resources,
      schedules: pluginOptions.slugs?.schedules ?? DEFAULT_SLUGS.schedules,
      services: pluginOptions.slugs?.services ?? DEFAULT_SLUGS.services,
    },
    userCollection: pluginOptions.userCollection ?? DEFAULT_USER_COLLECTION,
  }
}

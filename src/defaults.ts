import type { ReservationPluginConfig, ResolvedReservationPluginConfig } from './types.js'

import { DEFAULT_STATUS_MACHINE } from './types.js'

export const DEFAULT_SLUGS = {
  customers: 'customers',
  media: 'media',
  reservations: 'reservations',
  resources: 'resources',
  schedules: 'schedules',
  services: 'services',
} as const

export const DEFAULT_ADMIN_GROUP = 'Reservations'
export const DEFAULT_BUFFER_TIME = 0
export const DEFAULT_CANCELLATION_NOTICE_PERIOD = 24

export function resolveConfig(
  pluginOptions: ReservationPluginConfig,
): ResolvedReservationPluginConfig {
  const userStatusMachine = pluginOptions.statusMachine
  const rom = pluginOptions.resourceOwnerMode
  return {
    access: pluginOptions.access ?? {},
    adminGroup: pluginOptions.adminGroup ?? DEFAULT_ADMIN_GROUP,
    cancellationNoticePeriod:
      pluginOptions.cancellationNoticePeriod ?? DEFAULT_CANCELLATION_NOTICE_PERIOD,
    defaultBufferTime: pluginOptions.defaultBufferTime ?? DEFAULT_BUFFER_TIME,
    disabled: pluginOptions.disabled ?? false,
    hooks: pluginOptions.hooks ?? {},
    localized: false,
    resourceOwnerMode: rom
      ? {
          adminRoles: rom.adminRoles ?? [],
          ownerField: rom.ownerField ?? 'owner',
          ownedServices: rom.ownedServices ?? false,
        }
      : undefined,
    slugs: {
      customers: pluginOptions.slugs?.customers ?? DEFAULT_SLUGS.customers,
      media: pluginOptions.slugs?.media ?? DEFAULT_SLUGS.media,
      reservations: pluginOptions.slugs?.reservations ?? DEFAULT_SLUGS.reservations,
      resources: pluginOptions.slugs?.resources ?? DEFAULT_SLUGS.resources,
      schedules: pluginOptions.slugs?.schedules ?? DEFAULT_SLUGS.schedules,
      services: pluginOptions.slugs?.services ?? DEFAULT_SLUGS.services,
    },
    statusMachine: userStatusMachine
      ? {
          blockingStatuses:
            userStatusMachine.blockingStatuses ?? DEFAULT_STATUS_MACHINE.blockingStatuses,
          defaultStatus: userStatusMachine.defaultStatus ?? DEFAULT_STATUS_MACHINE.defaultStatus,
          statuses: userStatusMachine.statuses ?? DEFAULT_STATUS_MACHINE.statuses,
          terminalStatuses:
            userStatusMachine.terminalStatuses ?? DEFAULT_STATUS_MACHINE.terminalStatuses,
          transitions: userStatusMachine.transitions ?? DEFAULT_STATUS_MACHINE.transitions,
        }
      : { ...DEFAULT_STATUS_MACHINE },
    userCollection: pluginOptions.userCollection ?? undefined,
  }
}

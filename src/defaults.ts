import type {
  ReservationPluginConfig,
  ResolvedReservationPluginConfig,
  ResolvedStaffProvisioningConfig,
  StatusMachineConfig,
} from './types.js'

import { DEFAULT_STATUS_MACHINE } from './types.js'
import { validateTimezone } from './utilities/timezoneUtils.js'

function validateStatusMachine(sm: StatusMachineConfig): void {
  if (!sm.statuses.includes(sm.defaultStatus)) {
    throw new Error(`statusMachine.defaultStatus "${sm.defaultStatus}" is not in statuses array`)
  }
  for (const s of sm.blockingStatuses) {
    if (!sm.statuses.includes(s)) {
      throw new Error(`statusMachine.blockingStatuses contains "${s}" which is not in statuses array`)
    }
  }
  for (const s of sm.terminalStatuses) {
    if (!sm.statuses.includes(s)) {
      throw new Error(`statusMachine.terminalStatuses contains "${s}" which is not in statuses array`)
    }
  }
  for (const [from, targets] of Object.entries(sm.transitions)) {
    if (!sm.statuses.includes(from)) {
      throw new Error(`statusMachine.transitions has key "${from}" which is not in statuses array`)
    }
    for (const to of targets) {
      if (!sm.statuses.includes(to)) {
        throw new Error(`statusMachine.transitions["${from}"] targets "${to}" which is not in statuses array`)
      }
    }
  }
}

export const DEFAULT_RESOURCE_TYPES = ['staff', 'equipment', 'room']
export const DEFAULT_LEAVE_TYPES = ['vacation', 'sick', 'personal', 'closure', 'other']

function resolveStaffProvisioning(
  pluginOptions: ReservationPluginConfig,
  resourceTypes: string[],
): ResolvedStaffProvisioningConfig | undefined {
  const sp = pluginOptions.staffProvisioning
  if (!sp) {
    return undefined
  }

  if (!pluginOptions.resourceOwnerMode) {
    throw new Error('staffProvisioning requires resourceOwnerMode to be enabled')
  }
  if (sp.staffRoles.length === 0) {
    throw new Error('staffProvisioning.staffRoles must be a non-empty array')
  }
  const resourceType = sp.resourceType ?? 'staff'
  if (!resourceTypes.includes(resourceType)) {
    throw new Error(
      `staffProvisioning.resourceType "${resourceType}" is not in resourceTypes [${resourceTypes.join(', ')}]`,
    )
  }
  const userCollection = sp.userCollection ?? pluginOptions.userCollection
  if (!userCollection) {
    throw new Error(
      'staffProvisioning.userCollection is required when top-level userCollection is unset',
    )
  }

  return {
    beforeCreate: sp.beforeCreate,
    nameFrom: sp.nameFrom ?? 'name',
    resourceType,
    roleField: sp.roleField ?? 'role',
    staffRoles: sp.staffRoles,
    userCollection,
  }
}

export const DEFAULT_SLUGS = {
  customers: 'customers',
  media: 'media',
  reservations: 'reservations',
  resources: 'resources',
  schedules: 'schedules',
  services: 'services',
} as const

export const DEFAULT_ADMIN_GROUP = 'Reservations'
export const DEFAULT_ALLOW_GUEST_BOOKING = false
export const DEFAULT_BUFFER_TIME = 0
export const DEFAULT_CANCELLATION_NOTICE_PERIOD = 24

export function resolveConfig(
  pluginOptions: ReservationPluginConfig,
): ResolvedReservationPluginConfig {
  if (pluginOptions.resourceTypes !== undefined && pluginOptions.resourceTypes.length === 0) {
    throw new Error('resourceTypes must be a non-empty array')
  }
  if (pluginOptions.leaveTypes !== undefined && pluginOptions.leaveTypes.length === 0) {
    throw new Error('leaveTypes must be a non-empty array')
  }

  const resourceTypes = pluginOptions.resourceTypes ?? DEFAULT_RESOURCE_TYPES
  const userStatusMachine = pluginOptions.statusMachine
  const rom = pluginOptions.resourceOwnerMode
  const resolved: ResolvedReservationPluginConfig = {
    access: pluginOptions.access ?? {},
    adminGroup: pluginOptions.adminGroup ?? DEFAULT_ADMIN_GROUP,
    allowGuestBooking: pluginOptions.allowGuestBooking ?? DEFAULT_ALLOW_GUEST_BOOKING,
    cancellationNoticePeriod:
      pluginOptions.cancellationNoticePeriod ?? DEFAULT_CANCELLATION_NOTICE_PERIOD,
    defaultBufferTime: pluginOptions.defaultBufferTime ?? DEFAULT_BUFFER_TIME,
    disabled: pluginOptions.disabled ?? false,
    extraReservationFields: pluginOptions.extraReservationFields ?? [],
    hooks: pluginOptions.hooks ?? {},
    leaveTypes: pluginOptions.leaveTypes ?? DEFAULT_LEAVE_TYPES,
    localized: false,
    multiTenant: {
      cookieName: pluginOptions.multiTenant?.cookieName ?? 'payload-tenant',
      tenantField: pluginOptions.multiTenant?.tenantField ?? 'tenant',
    },
    resourceOwnerMode: rom
      ? {
          adminRoles: rom.adminRoles ?? [],
          ownedServices: rom.ownedServices ?? false,
          ownerCollection: rom.ownerCollection,
          ownerField: rom.ownerField ?? 'owner',
        }
      : undefined,
    resourceTypes,
    slugs: {
      customers: pluginOptions.slugs?.customers ?? DEFAULT_SLUGS.customers,
      media: pluginOptions.slugs?.media ?? DEFAULT_SLUGS.media,
      reservations: pluginOptions.slugs?.reservations ?? DEFAULT_SLUGS.reservations,
      resources: pluginOptions.slugs?.resources ?? DEFAULT_SLUGS.resources,
      schedules: pluginOptions.slugs?.schedules ?? DEFAULT_SLUGS.schedules,
      services: pluginOptions.slugs?.services ?? DEFAULT_SLUGS.services,
    },
    staffProvisioning: resolveStaffProvisioning(pluginOptions, resourceTypes),
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
    timezone: pluginOptions.timezone ?? 'UTC',
    userCollection: pluginOptions.userCollection ?? undefined,
  }

  validateStatusMachine(resolved.statusMachine)
  validateTimezone(resolved.timezone)

  return resolved
}

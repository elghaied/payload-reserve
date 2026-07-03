import type { CollectionConfig, Field, PayloadRequest } from 'payload'

// --- Duration & Capacity models ---

export type DurationType = 'fixed' | 'flexible' | 'full-day'

export type CapacityMode = 'per-guest' | 'per-reservation'

// --- Configurable status machine ---

export type StatusMachineConfig = {
  blockingStatuses: string[]
  /** Status treated as "cancelled" — fires beforeBookingCancel/afterBookingCancel, the cancellation notice period, and the cancellationReason field. */
  cancelStatus: string
  /** Status treated as "confirmed" — fires beforeBookingConfirm/afterBookingConfirm. */
  confirmStatus: string
  defaultStatus: string
  statuses: string[]
  terminalStatuses: string[]
  transitions: Record<string, string[]>
}

export const DEFAULT_STATUS_MACHINE: StatusMachineConfig = {
  blockingStatuses: ['pending', 'confirmed'],
  cancelStatus: 'cancelled',
  confirmStatus: 'confirmed',
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

// --- Resource owner mode ---

export type ResourceOwnerModeConfig = {
  /** Roles that can see all records (default: check req.user.collection === adminCollection) */
  adminRoles?: string[]
  /** Whether Services also get an owner field (default: false — Services are platform-managed) */
  ownedServices?: boolean
  /**
   * Collection the owner field relates to (where owners/staff live). Defaults to
   * `staffProvisioning.userCollection` when set, otherwise `slugs.customers`. Set
   * this when owners live in a different collection than your customers (e.g.
   * separate `users` and `customers` collections).
   */
  ownerCollection?: string
  /** Field name for the owner relationship on Resources (default: 'owner') */
  ownerField?: string
  /** User field holding the role for admin detection (default: staffProvisioning.roleField or 'role') */
  roleField?: string
}

export type ResolvedResourceOwnerModeConfig = {
  adminRoles: string[]
  ownedServices: boolean
  ownerCollection?: string
  ownerField: string
  roleField: string
}

// --- Staff provisioning ---

export type StaffProvisioningConfig = {
  /** Stamp tenant / custom fields onto the provisioned Resource before create. */
  beforeCreate?: (args: {
    data: Record<string, unknown>
    req: PayloadRequest
    user: Record<string, unknown>
  }) => Promise<Record<string, unknown>> | Record<string, unknown>
  /** User field copied into Resource `name` (default 'name', falls back to email). */
  nameFrom?: string
  /** resourceType to stamp (default 'staff'). Must be a valid resourceType. */
  resourceType?: string
  /** Field on the user holding the role (default 'role'). */
  roleField?: string
  /** Role value(s) marking a user as staff. Required, non-empty. */
  staffRoles: string[]
  /** Auth collection holding staff users. Defaults to top-level `userCollection`. */
  userCollection?: string
}

export type ResolvedStaffProvisioningConfig = {
  beforeCreate?: StaffProvisioningConfig['beforeCreate']
  nameFrom: string
  resourceType: string
  roleField: string
  staffRoles: string[]
  userCollection: string
}

// --- Plugin configuration ---

/**
 * Per-collection override applied to a generated collection. `fields` is a
 * function receiving the plugin's default fields so you can append/reorder/
 * replace them; supplied `hooks` are merged with (not replacing) the plugin's;
 * `access` composes per operation; `slug` is ignored (use the `slugs` option).
 */
export type CollectionOverride = {
  fields?: (args: { defaultFields: Field[] }) => Field[]
} & Omit<Partial<CollectionConfig>, 'fields' | 'slug'>

/** One external busy interval returned by `getExternalBusy` (ISO date strings). */
export type ExternalBusyInterval = { end: string; label?: string; start: string }

/**
 * App-supplied resolver mapping an external source (e.g. Google/Outlook sync
 * tables) to busy intervals for one resource over [start, end). Wired into
 * checkAvailability (bookings overlapping an interval are unavailable — the
 * interval blocks the WHOLE resource, all units) and into the
 * resource-availability endpoint (returned as `external` for distinct
 * rendering). The plugin calls it inside try/catch and treats an error as []
 * (fail-open): a calendar/sync failure must never block a real booking.
 */
export type GetExternalBusy = (args: {
  end: Date
  req: PayloadRequest
  resourceId: number | string
  start: Date
}) => Promise<ExternalBusyInterval[]>

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
  /** Allow bookings without a customer account by default (per-service override available) */
  allowGuestBooking?: boolean
  /** Hours of notice required before cancellation */
  cancellationNoticePeriod?: number
  /** Per-collection overrides applied to the generated collections (issue #4) */
  collectionOverrides?: {
    customers?: CollectionOverride
    reservations?: CollectionOverride
    resources?: CollectionOverride
    schedules?: CollectionOverride
    services?: CollectionOverride
  }
  /** Default buffer time in minutes between reservations */
  defaultBufferTime?: number
  /** Disable the plugin entirely */
  disabled?: boolean
  /** @deprecated Use `collectionOverrides.reservations.fields` instead. Extra fields appended to Reservations. */
  extraReservationFields?: Field[]
  /** Resolve external busy intervals (calendar sync etc.) folded into availability + calendar display. */
  getExternalBusy?: GetExternalBusy
  /** Plugin hooks for external integrations */
  hooks?: ReservationPluginHooks
  /** Configurable leave/exception type vocabulary (default: vacation/sick/personal/closure/other) */
  leaveTypes?: string[]
  /** Tenant scoping for the custom admin views (calendar, availability, dashboard). Applied only when the scoped collection has the tenant field AND the tenant cookie is set. */
  multiTenant?: {
    /** Cookie written by the tenant-selector (default 'payload-tenant'). */
    cookieName?: string
    /** Tenant field name on scoped collections (default 'tenant'). */
    tenantField?: string
    /**
     * Field on the tenant document holding its IANA timezone (default 'timezone').
     * When set and the selected tenant has a valid value, the admin views resolve
     * day-boundaries in that tenant's zone instead of the global `timezone`.
     */
    timezoneField?: string
  }
  /** Enable resource-owner multi-tenancy (opt-in) */
  resourceOwnerMode?: ResourceOwnerModeConfig
  /** Configurable resourceType vocabulary (default: staff/equipment/room) */
  resourceTypes?: string[]
  /** Override collection slugs */
  slugs?: {
    customers?: string
    media?: string
    reservations?: string
    resources?: string
    schedules?: string
    services?: string
  }
  /** Auto-provision a Resource from staff-role users (opt-in; requires resourceOwnerMode) */
  staffProvisioning?: StaffProvisioningConfig
  /** Configurable status machine (defaults to current behavior) */
  statusMachine?: Partial<StatusMachineConfig>
  /** IANA business timezone governing schedules and day boundaries (default 'UTC') */
  timezone?: string
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
  allowGuestBooking: boolean
  cancellationNoticePeriod: number
  collectionOverrides: {
    customers?: CollectionOverride
    reservations?: CollectionOverride
    resources?: CollectionOverride
    schedules?: CollectionOverride
    services?: CollectionOverride
  }
  defaultBufferTime: number
  disabled: boolean
  extraReservationFields: Field[]
  getExternalBusy: GetExternalBusy | undefined
  /** Whether the media collection (`slugs.media`) exists — set by the plugin; gates the image upload fields. */
  hasMediaCollection: boolean
  hooks: ReservationPluginHooks
  leaveTypes: string[]
  localized: boolean
  multiTenant: {
    cookieName: string
    tenantField: string
    timezoneField: string
  }
  resourceOwnerMode: ResolvedResourceOwnerModeConfig | undefined
  resourceTypes: string[]
  slugs: {
    customers: string
    media: string
    reservations: string
    resources: string
    schedules: string
    services: string
  }
  staffProvisioning: ResolvedStaffProvisioningConfig | undefined
  statusMachine: StatusMachineConfig
  timezone: string
  userCollection: string | undefined
}

export type ReservationStatus = 'cancelled' | 'completed' | 'confirmed' | 'no-show' | 'pending'

export type DayOfWeek = 'fri' | 'mon' | 'sat' | 'sun' | 'thu' | 'tue' | 'wed'

export type ScheduleType = 'manual' | 'recurring'

/** @deprecated Use DEFAULT_STATUS_MACHINE.transitions instead */
export const VALID_STATUS_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> =
  DEFAULT_STATUS_MACHINE.transitions as Record<ReservationStatus, ReservationStatus[]>

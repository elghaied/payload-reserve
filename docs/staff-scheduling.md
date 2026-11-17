# Staff Scheduling

Auto-provisioned staff resources, multi-day time off, and the vocabularies behind resource and leave types.

## Staff Auto-Provisioning

Enable `staffProvisioning` to automatically create an owner-scoped Resource whenever a user gains a staff role. Requires `resourceOwnerMode`.

```typescript
payloadReserve({
  userCollection: 'users',
  resourceOwnerMode: {
    adminRoles: ['admin'],
  },
  staffProvisioning: {
    staffRoles: ['staff', 'therapist'],  // roles that trigger auto-provisioning
    roleField: 'role',                   // field on the user doc (default: 'role')
    resourceType: 'staff',               // resourceType stamped on the new Resource (default: 'staff')
    nameFrom: 'name',                    // user field to use as Resource name (default: 'name', falls back to email)
  },
})
```

**Use `beforeCreate` to stamp tenant IDs or custom fields** before the Resource is saved:

```typescript
staffProvisioning: {
  staffRoles: ['staff'],
  beforeCreate: ({ data, user }) => ({
    ...data,
    tenant: user.tenant,   // forward the user's tenant to the new Resource
  }),
},
```

**Key behaviours:**

- **Idempotent** — deduplicates by owner; creating or re-saving a staff user never creates a second Resource.
- **Non-blocking** — provisioning failures are logged and do not prevent user creation or update.
- **Impersonation-based ownership** — the Resource is created as the new staff user, so `resource.owner` is always the user themselves (no ownership-bypass flag).
- **No auto-delete on demotion** — removing a staff role from a user does not delete their Resource.

## Full-Day-Range Time-Off

Schedule exceptions now support a date range and a leave type:

```typescript
// Schedule.exceptions[] — each entry can have:
{
  date: '2025-12-25',   // start date (always required)
  endDate: '2025-12-26', // optional range end, inclusive
  type: 'vacation',      // optional leave category
}
```

Any date falling within the range (inclusive) makes the resource fully unavailable for that day. This powers multi-day leave entries for staff schedules.

## Configurable Vocabularies

Customize the option lists for resource types and leave types:

```typescript
payloadReserve({
  resourceTypes: ['staff', 'room', 'equipment', 'vehicle'],  // default: ['staff','equipment','room']
  leaveTypes: ['vacation', 'sick', 'training', 'closure'],   // default: ['vacation','sick','personal','closure','other']
})
```

The first entry of `resourceTypes` becomes the default value for the `Resource.resourceType` field.

## Optional `Resource.services`

The `services` relationship on Resources is now optional. This lets a freshly provisioned staff Resource exist before services are assigned, avoiding validation errors during auto-provisioning.

---

↑ [Back to README](../README.md)

# Multi-Tenancy

Two separate features: `resourceOwnerMode` (each user manages their own resources) and `multiTenant` (works with `@payloadcms/plugin-multi-tenant`).

## Resource owner mode

Enable `resourceOwnerMode` to support Airbnb-style platforms where each user manages their own listings (Resources) and sees only the reservations made against them. This is opt-in — single-tenant installs are unaffected.

```typescript
payloadReserve({
  userCollection: 'users',       // required: which auth collection holds owners
  resourceOwnerMode: {
    adminRoles: ['admin'],        // roles that bypass all filters (see all records)
    ownerField: 'owner',          // field name added to Resources (default: 'owner')
    ownedServices: false,         // set true if Services should also be owner-scoped
  },
})
```

**What this does automatically:**

| Collection | Behaviour |
|------------|-----------|
| Resources | Adds an `owner` relationship field (auto-populated on create, re-assignable by admins only); owners read/update/delete only their own records |
| Schedules | Owners read/update/delete only schedules whose resource they own (join through `resource.owner`); a schedule may only be created on, or moved to, a resource the caller owns (4.1.2) |
| Reservations | Owners can read reservations for their resources; mutations are admin-only |
| Services | Unchanged by default; set `ownedServices: true` to apply the same owner pattern |

The `access` override in plugin config always takes precedence over the auto-wired functions, so you can fine-tune any collection without losing the rest.

### The availability grid follows Resources access

Under `resourceOwnerMode`, a staff user (a role listed in `staffRoles` but **not** in `adminRoles`) can now only pull `/api/reserve/resource-availability` for their **own** resource — the same restriction the Resources collection already applies to ordinary reads. Add the role to `adminRoles` to restore the wider (all-resources) view for that user.

## With `@payloadcms/plugin-multi-tenant`

### Plugin order and the `collections` option

`payloadReserve()` must be listed **before** `multiTenantPlugin()` in the `plugins` array, and this plugin's collection slugs must appear in the multi-tenant plugin's own `collections` option:

```typescript
plugins: [
  payloadReserve({ /* ... */ }),
  multiTenantPlugin({
    collections: {
      // `customers` only exists in standalone mode (no `userCollection`).
      // Leaving it out means /api/reservation-customer-search keeps
      // returning every tenant's customers — there is no tenant field for
      // it to filter on.
      customers: {},
      reservations: {},
      resources: {},
      schedules: {},
      services: {},
    },
    // ...
  }),
]
```

At `payloadReserve`'s own plugin-time no tenant field exists on any collection yet (multi-tenant hasn't run), and multi-tenant only ever scopes the collections named in its own `collections` option — it never discovers them. So if you enable multi-tenant elsewhere in your config but forget to list payload-reserve's collections there, those documents silently stay readable across every tenant. The plugin now detects this at boot and logs a warning naming the unscoped slugs:

```
payload-reserve setup check: 1 thing needs attention.

1. these collections are NOT tenant-scoped: reservations, resources, schedules, services, customers. This config looks like it enables multi-tenancy (another collection carries a "tenant" field, or an auth collection carries a "tenants" membership array) — detection is a heuristic, so disregard this if you are not using multi-tenancy. Otherwise add these slugs to the multi-tenant plugin's "collections" option, or their documents stay readable across tenants.
```

Detection is a **heuristic** — the multi-tenant plugin exposes nothing at init to check directly — so the warning arms on either of two independent signals: some collection in your config carries a top-level tenant field, or an auth collection carries multi-tenant's `tenants` membership array. Each covers the other's blind spot (scoping *only* these collections and forgetting them all leaves nothing else carrying the field; `tenantsArrayField.includeDefaultField: false` removes the array). Neither is exact, so the warning can fire on a config that merely looks tenant-shaped — it is only ever a warning and never blocks boot.

Two more diagnostics fire under the same "multi-tenant detected" condition. In **standalone mode**, `/api/reserve/book`'s tenant-membership probe (above) is a real membership check only when the caller authenticates against the same collection multi-tenant wraps — standalone customers never do, so the plugin warns that the probe cannot actually verify a logged-in customer's membership there; point `userCollection` at multi-tenant's own admin auth collection to close it. In **`userCollection` mode**, if your auth collection carries *neither* a flat tenant field *nor* multi-tenant's `tenants` membership array, it is genuinely unscoped and the plugin warns naming it — the remedy depends on which collection multi-tenant treats as its own admin/tenant-owning collection: if it's this one, it needs the `tenants` array (which multi-tenant adds automatically unless disabled), not a listing in `collections`, which multi-tenant itself rejects for that collection; only a genuinely separate auth collection belongs in `collections`.

### Per-tenant timezones

See [Timezones](./timezones.md#per-tenant-timezones-multitenant).

### Tenant-scoped customer search

The reservation form's customer picker (and its backing `/api/reservation-customer-search` endpoint) restricts results to the **selected tenant** — read from the tenant cookie — whenever the customers collection carries the multi-tenant `tenant` field. This prevents picking a customer from another tenant (which would otherwise fail on save with a tenant mismatch). Like the per-tenant timezone behaviour, it is purely additive: plain single-tenant installs (customers collection without a tenant field, or no tenant cookie) are unaffected and the search spans all customers as before.

```typescript
payloadReserve({
  multiTenant: {
    tenantField: 'tenant',        // tenant relationship field on collections (default: 'tenant')
    cookieName: 'payload-tenant',  // selected-tenant cookie (default: 'payload-tenant')
  },
})
```

---

↑ [Back to README](../README.md)

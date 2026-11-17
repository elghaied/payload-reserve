# Access Control

What each kind of user can reach by default, and how the public endpoints authorize a request. For the `userCollection` rule you must supply yourself, see [Configuration → Access control for customers](./configuration.md#access-control-for-customers).

## Standalone mode: customers see only their own records

**Before 4.1.1, the Quick Start config was exploitable by any customer with a login.** Reservations and the generated `customers` auth collection sat on Payload 3's built-in default access — any signed-in user for read, update and delete — so through the stock `/api/reservations` and `/api/customers` REST API a customer could read, rewrite and delete every other customer's reservation, list every customer's email/phone/notes, and `PATCH` another customer's `password` and log in as them. Only `create` was guarded. Reported privately by an external researcher; fixed and covered by `dev/standaloneAccess.int.spec.ts`.

Standalone mode (no `userCollection`) now ships these defaults, with nothing to configure:

| Collection | Customer | Staff/admin (any other auth collection) |
|------------|----------|------------------------------------------|
| Reservations | read/update **own rows only** (`customer equals req.user.id`; guest bookings are unreachable); no delete; cannot re-assign `customer` | everything |
| Customers | read/update **own document only**; `notes` is staff-only at field level; no delete | everything |

`create` on Reservations is open to any signed-in user (with `enforceCustomerOwnership` pinning `customer` to the caller); `create` on Customers is staff-only, and `access.customers.create: () => true` opens self-registration without reopening reads. Any rule you pass in `access.reservations`/`access.customers` replaces the default for that operation only.

**`userCollection` mode is not changed** — staff and customers share one collection there and the plugin cannot tell them apart without a role, so Reservations stays on Payload's default and the plugin warns at boot when nothing narrows `read`. If customers log in to that collection, supply `access.reservations` yourself; the pattern is in [Configuration → Access control for customers](./configuration.md#access-control-for-customers). `resourceOwnerMode` already brings its own rules and is unaffected.

## Endpoints enforce collection access control

Four endpoints now gate the request through Payload's normal access-control pipeline (`overrideAccess: false` + `req`) instead of reading privileged. The governing rule is **gate the request with one explicit access-checked call, then keep the derived reads privileged** — an endpoint authorizes *what you asked for*, and once you are past that gate it still assembles a complete answer. So this is deliberately a per-path change, not a blanket flip:

| Endpoint | What delegates to access control | What stays privileged | Why |
|---|---|---|---|
| `/api/reservation-customer-search` | the customer query itself | — | The whole endpoint is the read; nothing is derived from it. |
| `/api/reserve/resource-availability` | a `findByID` probe of the requested resource (404 on denial) | every read that builds the grid: the resource itself, its schedules, its busy reservations, and — only when `slotHolds` is enabled — its unexpired slot holds. So **four** reads for a plain resource with `slotHolds` on, three with it off. Each `requiredResources` pool its services name adds three more (the pool's own resource read, its busy reservations, its holds), or two with `slotHolds` off. Two are Resources reads, and there is no separate services read | The probe decides *whether you may see this resource*. The grid must then show every conflicting booking, including other tenants' and other owners' — a busy slot you can't see is a double-booking. |
| `/api/reserve/cancel` | the update, **only** on the privileged-non-owner path | the reservation read, and the update on the owner and guest-token paths | For a guest the cancellation token *is* the authorization. For an owner, `resourceOwnerMode`'s `update: adminOnly` would otherwise block a customer cancelling their own booking. Ownership and token matching are checked in the endpoint before either path is taken. |
| `/api/reserve/effective-timezone` | the tenant-document read (falls back to the global zone on denial) | — | Prevents a forged tenant cookie resolving a zone you have no membership in. |

- **Plain installs** (no `resourceOwnerMode`, no `multiTenant`, and no custom `access` overrides) are unaffected: the plugin's standalone rules let any signed-in user read the catalog, and staff read everything.
- **A `userCollection` with a restrictive `read` rule now narrows customer search accordingly.** If the existing auth collection you pointed `userCollection` at defines its own `access.read` — for example, one that scopes a user to their own record or to a department — `/api/reservation-customer-search` now respects it, because the endpoint no longer out-permissions the collection it reads from. If staff stop seeing customers they used to see, the fix is in that collection's own `access.read`, not in the plugin.

### `/api/reserve/book`: the tenant probe is the gate, not `overrideAccess`

`POST /api/reserve/book` does **not** follow the single "gate with one access-checked call" pattern the table above uses. Its write stays **privileged for every caller** (`overrideAccess: true`, passed explicitly), and a separate access-checked probe is what authorizes the tenant. Both halves of that are deliberate:

1. **`overrideAccess: false` cannot gate this write, so it is not used to pretend otherwise.** Payload's `create` access check (`executeAccess`) only tests the *truthiness* of what an access function returns and — unlike read/update/delete — never applies a returned `Where`, because there is no existing document to filter. Multi-tenant scopes access precisely by returning a `Where`, so its tenant-scoped `create` access passes for *any* authenticated member of *any* tenant no matter how this flag is set. Delegating would therefore add no isolation while actively breaking real callers: `resourceOwnerMode` makes reservation `create` **admin-only** (`makeReservationOwnerAccess`), so both an ordinary customer booking for themselves *and* a non-admin staff or resource-owner account booking a walk-in would get a flat `403` from an endpoint that served them in every earlier release.
2. **`callerMayUseTenant` (which tenant they may write into) is the gate.** For every authenticated caller, an access-checked (`overrideAccess: false`) probe read (`src/utilities/tenantTimezone.ts`) checks any explicit `tenant` in the request body against the tenants collection, and a denial returns a clean `403` before `payload.create` is ever called. This is what **closes** the formerly-open hole where an authenticated tenant-A caller could `POST` an explicit `tenant: <tenant-B-id>` and land the reservation there. A `hasMany` tenant field is supported: every id in the array is probed.

Who may book for whom is enforced separately and independently of either of the above: an authenticated non-privileged caller is forced onto their own customer id, and an anonymous caller may not name an existing customer at all (the guest flow covers them).

**Precondition worth knowing:** the probe is a genuine membership check only when the caller authenticates against the *same* collection multi-tenant wraps as its admin/tenant-owning collection — true whenever `userCollection` points at that collection. In **standalone mode** (no `userCollection`), customers authenticate against the plugin's own `slugs.customers`, a collection multi-tenant never wraps, so the probe passes for any tenant id supplied by a logged-in customer. The plugin warns about this at boot whenever standalone mode + multi-tenant is detected; the fix is `userCollection` pointing at multi-tenant's admin auth collection, or your own tenant check in front of the endpoint.

**Consequence to know about, by design, not an oversight:** because the write is privileged, a consumer's own `access.reservations.create` — and any field-level `create` access added via `collectionOverrides.reservations` — is **not** applied to bookings made through this endpoint. That is unchanged from every release before tenant scoping existed, and nothing about it is exploitable (who may book for whom is enforced in the endpoint itself, and the tenant is probed). But if you add create access via `collectionOverrides` expecting it to run for every booking, it will not run for this one — put the rule in a `beforeChange` hook (which does run) or in the `hooks.beforeBookingCreate` plugin hook instead.

The reservations collection's own REST API (`POST /api/reservations`) is unaffected — it goes through Payload's access control as normal.

---

↑ [Back to README](../README.md)

---
'payload-reserve': minor
---

Fix plugin wiring and configuration correctness:

- **Owner relationship (C1):** the Services `owner` field now relates to the resolved owner collection (`ownerCollection` → `staffProvisioning.userCollection` → customers) instead of a hardcoded customers slug, so separate users/customers setups work.
- **`disabled` (C3):** a disabled plugin now still registers its collections (with collection-level hooks stripped, endpoints/admin/provisioning skipped) so the database schema stays stable — toggling `disabled` no longer generates table-dropping migrations. A disabled plugin with an invalid sub-config no longer throws at boot. (The owner field's create-time default hook remains, since it's field-level and schema-coherent.)
- **Admin detection (B4):** owner-mode admin detection reads the configured role field (new `resourceOwnerMode.roleField`, defaulting to `staffProvisioning.roleField` or `'role'`) instead of a hardcoded `user.role`, so apps using a `roles: string[]` (or any custom) field aren't silently demoted.
- **Access overrides (C9):** the `access` option now composes per-operation with owner-mode rules instead of replacing them wholesale — tweaking only `read` keeps owner-mode's create/update/delete intact.
- **Staff backfill (C5):** staff provisioning now (re)provisions pre-existing staff and users whose resource was deleted on their next save, relying on the dedup-by-owner query rather than an early "was already staff" return.
- **Clear errors:** a missing `userCollection` (C2) and a collection-slug collision (C11) now throw actionable errors instead of failing silently / with a generic Payload error.
- **Status machine (C6):** init-time validation now rejects a terminal status that has outgoing transitions, and a terminal `defaultStatus`.
- **Schedule time validation (C10):** malformed `HH:mm` times now surface the format error instead of a misleading "endTime must be after startTime".
- **Security:** a non-privileged authenticated user can no longer create a reservation on behalf of another customer through Payload's default collection REST API (the mass-assignment guard now applies there too, not only at `/api/reserve/book`).

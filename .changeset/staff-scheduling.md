---
'payload-reserve': minor
---

Add staff scheduling support: opt-in `staffProvisioning` auto-creates owner-scoped Resources from staff-role users (requires `resourceOwnerMode`), full-day-range typed time-off on `Schedule.exceptions` (`endDate` + `type`), and configurable `resourceTypes`/`leaveTypes` vocabularies. `Resource.services` is now optional. Provisioning assigns Resource ownership securely by impersonating the new staff user (no ownership-bypass flag). The `resourceType` field now defaults to the first configured type (`staff` by default).

**Postgres:** additive migration required for the new `exceptions.endDate` / `exceptions.type` columns (and the resourceType / leave-type enums if customized). Mongo needs no migration. Backwards-compatible: with no new options set and `resourceOwnerMode` off, behaviour is unchanged.

---
'payload-reserve': major
---

- **BREAKING** `peerDependencies` now require `payload ^3.86.0`, `@payloadcms/ui ^3.86.0`, and `@payloadcms/translations ^3.86.0` (was `^3.79.0`). Upgrade Payload before upgrading this plugin.
- **BREAKING** `active: false` on a Service or Resource is now enforced at booking time — creating or updating a reservation against an inactive service/resource (or any multi-resource `items[]` entry referencing one) is rejected, and inactive services/resources are excluded from availability. Set `enforceActive: false` in the plugin config to restore the previous behaviour, where `active` was purely a display flag with no effect on booking or availability.
- **BREAKING** `getAvailableSlots` now returns `{ reason?, slots }` instead of a bare `Slot[]` array. Direct importers must update destructuring, e.g. `const { slots } = await getAvailableSlots(...)`. The `EmptyReason` type is exported alongside it (from both `src/index.ts` and `src/services/index.ts`) and describes why `slots` came back empty (e.g. `'service_inactive'`, `'resource_inactive'`, `'no_windows'`, `'all_slots_taken'`).
- Added: Services now show a read-only `resources` field — a join over `Resources.services` — listing which resources perform that service. `Resources.services` remains the only editable side; this is purely a reverse view for the admin UI and API reads.
- Added: empty availability responses from `/api/reserve/availability` and `/api/reserve/slots` now carry a machine-readable `reason` field explaining why no slots were returned.

**Migration notes:**
- If your `collectionOverrides.services` already appends a field named `resources`, rename it — it now collides with the built-in join. (The name used in the docs, `referencedResources`, is a different name and is unaffected.)
- If your `collectionOverrides.resources` removes, renames, or nests the `services` field inside a named group or tab, the new Services `resources` join is silently skipped rather than added — the app still boots, the field simply doesn't appear.

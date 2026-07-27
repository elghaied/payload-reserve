---
'payload-reserve': major
---

- **BREAKING** `peerDependencies` now require `payload ^3.86.0`, `@payloadcms/ui ^3.86.0`, and `@payloadcms/translations ^3.86.0` (was `^3.79.0`). Upgrade Payload before upgrading this plugin.
- **BREAKING** `active: false` on a Service or Resource is now enforced at booking time. Creating a reservation against an inactive service/resource (or any multi-resource `items[]` entry referencing one) is rejected, as is updating a reservation to newly reference one **or to reschedule it** — any change to `startTime`, `endTime`, `service`, `resource`, `items`, or `guestCount` re-checks every reference, so a booking cannot be moved onto a resource that availability would refuse to offer. Inactive services/resources are also excluded from availability. Edits that do not touch scheduling are unaffected: an existing booking stays confirmable, cancellable, and otherwise editable after its service or resource is deactivated later. Set `enforceActive: false` in the plugin config to restore the previous behaviour, where `active` was purely a display flag with no effect on booking or availability.
- **BREAKING** `getAvailableSlots` now returns `{ reason?, slots }` instead of a bare `Slot[]` array. Direct importers must update destructuring, e.g. `const { slots } = await getAvailableSlots(...)`. The `EmptyReason` type is exported alongside it (from both `src/index.ts` and `src/services/index.ts`) and describes why `slots` came back empty (e.g. `'service_inactive'`, `'resource_inactive'`, `'no_windows'`, `'window_too_short'`, `'all_slots_taken'`).
- Added: Services now show a read-only `resources` field — a join over `Resources.services` — listing which resources perform that service. `Resources.services` remains the only editable side; this is purely a reverse view for the admin UI and API reads.
- Added: empty availability responses from `/api/reserve/availability` and `/api/reserve/slots` now carry a machine-readable `reason` field explaining why no slots were returned.
- Added: `window_too_short` — availability now distinguishes "every shift is shorter than the service duration" from "the day is fully booked", instead of reporting both as `all_slots_taken`.
- Added: the plugin logs a warning at init when the Services `resources` join is skipped because a `collectionOverrides.resources` override removed, renamed, or nested the `services` field — previously the field simply went missing with no explanation.

**Migration notes:**
- If your `collectionOverrides.services` already appends a field named `resources`, rename it — it now collides with the built-in join. (The name used in the docs, `referencedResources`, is a different name and is unaffected.)
- If your `collectionOverrides.resources` removes, renames, or nests the `services` field inside a named group or tab, the new Services `resources` join is silently skipped rather than added — the app still boots, the field simply doesn't appear.

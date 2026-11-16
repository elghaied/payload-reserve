---
'payload-reserve': major
---

Payload 4 support. This major requires `payload`, `@payloadcms/ui` and `@payloadcms/translations` `^4.0.0-beta.9` (Node `^24.22.3 || >=26.13.1`, Next.js 16.4+ when used with Next). Payload 3 projects stay on `payload-reserve` 4.x.

**Changed**

- Every internal Local API call passes `overrideAccess` explicitly. Payload 4 flipped the default to `false`; the plugin's hooks, endpoints and services keep the behaviour they had on Payload 3.
- Standalone-mode access rules that used to rely on Payload's default are now explicit, because Payload 4's default admits only the admin user collection: customers may still `create` their own reservation through the collection API and `read` Services, Resources and Schedules.
- Plugin collections set `versions: false` and `authorship: false`, so installing or upgrading adds no version tables or `createdBy`/`updatedBy` columns. Opt back in through `collectionOverrides`.
- Admin styles use Payload 4's `--color-*` tokens in place of the retired `--theme-*` variables, and the reservation detail drawer pads its own content (Payload 4's `Drawer` no longer does).
- `acquireBookingLock` and `validateConflicts` handle Payload 4's on-demand `validate` operation (no lock is taken; an existing reservation does not conflict with itself).
- `CustomerField` and `AvailabilityTimeField` are typed with Payload 4's field props types.

**Upgrading**

- If you call the Local API on the plugin's collections from your own code, add `overrideAccess: true` where you relied on the old default (`npx @payloadcms/codemod` does this).
- Under `userCollection` mode with no `access` configured, the plugin's collections now fall back to Payload 4's default (admin collection only) instead of "any signed-in user".

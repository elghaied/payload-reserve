---
'payload-reserve': major
---

Payload 4 support. This major requires `payload`, `@payloadcms/ui` and `@payloadcms/translations` `^4.0.0-beta.9` (Node `^24.22.3 || >=26.13.1`, Next.js 16.4+ when used with Next). Payload 3 projects stay on `payload-reserve` 4.x.

**Changed**

- Every internal Local API call passes `overrideAccess` explicitly. Payload 4 flipped the default to `false`; the plugin's hooks, endpoints and services keep the behaviour they had on Payload 3.
- Standalone-mode access rules that used to rely on Payload's default are now explicit, because Payload 4's default admits only the admin user collection: customers may still `create` their own reservation through the collection API and `read` Services, Resources and Schedules.
- Plugin collections set `versions: false` and `authorship: false`, so installing or upgrading adds no version tables or `createdBy`/`updatedBy` columns. Opt back in through `collectionOverrides`.
- Admin styles use Payload 4's `--color-*` tokens in place of the retired `--theme-*` variables, and the reservation detail drawer pads its own content (Payload 4's `Drawer` no longer does).
- Admin stylesheets are plain CSS with fixed class names (`reserve-calendar__toolbar`, `reserve-detail__…`, …) instead of CSS modules, the pattern Payload's own plugins use. This is what makes the admin components render on TanStack Start, and it gives hosts stable class names to style against. Hashed class names from 4.x no longer exist.
- Works on TanStack Start (`@payloadcms/tanstack-start`) as well as Next.js; TanStack hosts add `payload-reserve` to `noExternal` (see README).
- The reservation hooks handle Payload 4's on-demand `validate` operation (`payload.validate`, `POST /api/reservations/:id/validate`): the verdict matches what the real create or update would do, no lock is taken, and `beforeBookingConfirm`/`beforeBookingCancel` are not fired for a dry run.
- The boot warning for `userCollection` mode now tells you when its users are locked out of the collection REST API (the collection is not the admin collection) instead of claiming everything is open.
- `CustomerField` and `AvailabilityTimeField` are typed with Payload 4's field props types.

**Added**

- `payload-reserve/sdk` — a typed client for the booking endpoints (`getSlots`, `hold`, `releaseHold`, `book`, `cancel`) with one `ReserveError` carrying `status`, `message`, `code`, `path` and `retryable`. No Payload or React import, so it runs in any frontend.
- The admin Availability grid shows slot holds ("Held"), read from a new staff-only `GET /api/reserve/held` endpoint that never returns tokens.
- Boot diagnostics are printed as one "payload-reserve setup check" block listing what needs attention and what was checked and is fine, instead of separate warning lines.
- Endpoint errors that used `message` (`/reserve/cancel`, customer search, one `/reserve/availability` case) now also carry `error`, the key every other endpoint uses. `message` is kept.

**Upgrading**

- If you call the Local API on the plugin's collections from your own code, add `overrideAccess: true` where you relied on the old default (`npx @payloadcms/codemod` does this).
- Under `userCollection` mode with no `access` configured, the plugin's collections now fall back to Payload 4's default (admin collection only) instead of "any signed-in user".

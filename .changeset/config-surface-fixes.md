---
'payload-reserve': minor
---

Three configuration-surface fixes:

- **Configurable confirm/cancel statuses (C7):** `StatusMachineConfig` gains `confirmStatus` and `cancelStatus` (default `'confirmed'`/`'cancelled'`). All confirm/cancel logic — the `beforeBookingConfirm`/`afterBookingConfirm`/`beforeBookingCancel`/`afterBookingCancel` plugin hooks, the cancellation notice-period rule, and the `cancellationReason` field condition — now reads them instead of the hardcoded literals, so a custom status vocabulary no longer silently disables that behavior. Both are validated against `statuses` at init. Default machines are unaffected.
- **Graceful media handling (C8):** the `image` upload field on Services and Resources is added only when the configured `slugs.media` collection actually exists in the config. Installs without a media collection no longer hit an opaque init error — the field is simply omitted.
- **Safer user-collection extension (C4):** the injected `name` field is no longer `required`, so an existing users collection with rows lacking a name can still be updated. Field deduplication now descends through tabs/rows/collapsibles/unnamed groups, so a field nested in a presentational container isn't re-injected at the top level.

---
'payload-reserve': minor
---

Full internationalization of the admin UI plus 11 new bundled locales.

- **Internationalized all remaining hardcoded strings** — every field label, description, and select option (`owner`, `resourceType`, `requiredResources`, guest fields, `allowGuestBooking` + options, `items` description), the dashboard widget label, the guest-booking validation errors, and the availability time-picker / lane-timeline component strings now go through the translation layer. No user-facing English remains hardcoded in collections, hooks, or admin components.
- **Added 11 translation files**: French (`fr`), German (`de`), Spanish (`es`), Russian (`ru`), Polish (`pl`), Turkish (`tr`), Arabic (`ar`), Simplified Chinese (`zh`), Indonesian (`id`), Hindi (`hi`), and Persian/Farsi (`fa`) — each with full key parity with `en` (154 keys) and all `{{…}}` interpolation placeholders preserved.

All locales except Hindi ship in Payload core and appear in the admin language switcher automatically. Hindi (`hi`) is not bundled by Payload core, so host apps must register it as a custom i18n language for it to be selectable; the translations merge in once it is.

Backwards-compatible: translations merge into `config.i18n` and host-provided translations still take precedence. No API or schema changes.

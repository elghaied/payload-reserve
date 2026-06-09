---
'payload-reserve': minor
---

Make the custom Reservations admin views (calendar, pending list, availability grid, dashboard widget) tenant-aware. They now respect the `@payloadcms/plugin-multi-tenant` selected tenant via the `payload-tenant` cookie, auto-detected by the presence of a tenant field on the scoped collections (resources, schedules, reservations). Configurable via the new `multiTenant` plugin option (`tenantField`, `cookieName`). Single-tenant installs are unaffected — no tenant field and/or no cookie means no filtering is applied.

---
"payload-reserve": minor
---

Per-tenant timezones for `multiTenant` mode. The custom admin views (Calendar, Availability grid, Dashboard widget) now resolve day-boundaries in the **selected tenant's** timezone instead of a single global zone, fixing shifted day-boundaries for tenants outside the configured `timezone`.

- New `multiTenant.timezoneField` option (default `'timezone'`) points at the IANA timezone field on your tenant document. Resolution precedence is `tenant.<timezoneField> → global timezone → 'UTC'`; a missing/invalid value falls back to the global default.
- New `GET /api/reserve/effective-timezone` endpoint returns the resolved zone for the current request's selected tenant (read from the tenant cookie); the client calendar uses it for day-boundary rendering.
- `GET /api/reserve/resource-availability` now resolves day windows in the selected tenant's zone and echoes the resolved `timeZone` in its response.

Purely additive — `multiTenant.timezoneField` is optional and plain single-tenant installs are unaffected (no tenant relationship / no tenant cookie ⇒ global zone, no extra DB read).

---
'payload-reserve': patch
---

Fix two multi-tenant issues:

- **Customer search is now tenant-scoped.** The `/api/reservation-customer-search` endpoint (used by the reservation customer picker) restricts results to the selected tenant — read from the tenant cookie — whenever the customers collection carries the multi-tenant `tenant` field. Plain single-tenant installs are unaffected (no tenant field / no cookie ⇒ no scoping).
- **Flexible-duration reservations can be saved from the admin UI.** The reservation `endTime` field was unconditionally read-only, which contradicted the validation that requires a user-supplied `endTime` for `flexible` services. `endTime` is now editable; for `fixed`/`full-day` services it is still auto-computed and overwritten on save.

---
'payload-reserve': patch
---

Admin components (calendar, lane timeline, availability overview, dashboard widget) now key days, bucket reservations, and render times in the configured business `timezone` instead of the browser's timezone (calendar/grid) or a UTC/local mix (availability overview). This fixes availability shading not matching the server's day keys when the admin's browser timezone differs from the server, and exceptions/manual slots rendering one day off in the weekly overview. The dashboard widget's "today" is now the business day, not the server's. Slot endpoints reject impossible calendar dates (e.g. `2026-13-45`) with a 400. Exception-date instants are interpreted in the business timezone (documented interim semantics until the admin picker normalizes storage).

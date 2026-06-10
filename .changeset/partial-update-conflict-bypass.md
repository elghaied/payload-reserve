---
'payload-reserve': patch
---

Fix reservation update validation. Updates that touch no scheduling-relevant field (notes edits, status transitions out of blocking statuses) no longer re-run conflict validation — previously every update re-validated, so reservations became un-editable when service buffer times or schedules changed after booking. Updates that do change scheduling fields (startTime, endTime, resource, service, items, guestCount, or a status moving into a blocking status) are validated against the full merged document, explicitly merged from the stored reservation rather than relying on Payload's internal field backfill. endTime is recomputed from the merged document on reschedule. Flexible-duration reservations now reject inverted windows (endTime at or before startTime) on create and update — previously a reschedule past the stored endTime was silently persisted and invisible to conflict queries.

---
'payload-reserve': minor
---

Calendar: admin-language dates, configurable week start, host-fit padding, and a drawer close button.

- Dates and times in the calendar, lanes, detail drawer, availability overview, time field and dashboard widget now follow the admin UI language (`i18n.language`) instead of the browser locale. This also fixes a React hydration error ("Hydration failed because the server rendered text didn't match the client") on every calendar load when the browser locale differed from the server's — the calendar is server-rendered.
- `calendar.weekStartsOn` (`0`–`6`, default `0` = Sunday): first day of the week in the month/week grids and the availability overview; day headers rotate to match. Validated at init.
- The calendar wrapper padding is overridable through CSS custom properties `--reserve-calendar-padding` (default `20px`) and `--reserve-calendar-padding-mobile` (default `12px`, ≤768px), so a host can align the calendar with its own page gutter.
- The reservation detail drawer has a visible close button (label from Payload's `general:close`) and 16px of top room.
- `formatReservationTime`, `formatReservationDateLabel` and `externalPillLabel` gain a trailing optional `locale` argument (additive).

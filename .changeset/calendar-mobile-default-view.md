---
'payload-reserve': minor
---

Calendar: configurable landing view and a real phone layout.

- `calendar.defaultView` (default `'month'`) and `calendar.mobileDefaultView` (≤768px, falls back to `defaultView`) pick the tab the reservations calendar opens on. Both are validated at init, and so — newly — is `calendar.hiddenViews`: a misspelled view name used to be silently ignored and now throws at boot.
- On a phone (Payload's `s` breakpoint, 768px): the toolbar stacks with a scrollable tab strip and a floating **+** button; **Month** shows status dots per day and lists the selected day's bookings under the grid (tap a row for the detail drawer, **+** in the list header to create on that day); **Week** becomes a row of seven day chips over a single hourly day column; **Lanes** scrolls inside its own track with sticky labels; **Pending** renders as stacked cards; the detail drawer goes full width. Desktop rendering is unchanged.
- New translation key `calendarNoBookingsDay` in all 12 locales.
- `AvailabilityOverview` (`/reservation-availability`) is not part of this change.

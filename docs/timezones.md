# Timezones

How the plugin decides which calendar day and wall-clock hour a booking falls on.

## Business Timezone

Set a plugin-level `timezone` (IANA name, default `'UTC'`) to govern all schedule resolution — what `HH:mm` schedule times mean, which calendar day a `date=YYYY-MM-DD` query maps to, and full-day booking boundaries:

```typescript
payloadReserve({
  timezone: 'America/New_York',  // default: 'UTC'
})
```

Without this, day resolution mixes server-local and UTC semantics — on non-UTC servers the slots API can resolve the wrong calendar day. With `timezone` set, all server-side day math runs via the built-in `Intl` API (no extra dependency). `'UTC'` on a UTC server is identical to the previous behaviour. The configured timezone is exposed to admin components via `config.admin.custom.reservationTimezone`.

**Date-only schedule fields are not re-keyed in this zone.** `exceptions[].date`/`endDate` and `manualSlots[].date` name a calendar day; the day is the UTC calendar date of the stored value, which is what both the admin day picker (noon UTC) and a bare `'2025-12-25'` written through the API encode. Before 4.1.1 they were re-keyed in the business zone, so `'2025-12-25'` closed December 24 and left the 25th bookable for any zone west of UTC — see [Booking Features → Exceptions and Time Off](./booking-features.md#exceptions-and-time-off).

## The admin calendar uses the business timezone

The admin Calendar's grid instants, click targets, day-key sequences, and month/week header labels are now computed in the plugin's business timezone (`timezone`, or the selected tenant's zone under `multiTenant`) rather than the browser's local timezone. Previously, viewing the calendar from a timezone different than the business's could make clicking a displayed time slot book a different wall-clock hour than the one shown.

## Per-tenant timezones (`multiTenant`)

When tenant scoping is active, the admin Calendar, Availability grid, and Dashboard widget resolve day-boundaries in the **selected tenant's** zone instead of one global zone — so a tenant in `America/New_York` and a tenant in `Europe/Paris` each see their own local days. Point `multiTenant.timezoneField` at the IANA timezone field on your tenant document:

```typescript
payloadReserve({
  timezone: 'UTC',                          // global default / fallback
  multiTenant: {
    timezoneField: 'timezone',              // field on the tenant doc (default: 'timezone')
  },
})
```

Resolution precedence is `tenant.<timezoneField> → global timezone → 'UTC'`; a tenant with no (or an invalid) timezone value transparently falls back to the global default. The zone is resolved server-side from the tenant cookie — the client calendar reads it from `GET /api/reserve/effective-timezone`. This is purely additive: plain single-tenant installs (no tenant relationship / no tenant cookie) keep the global zone with no extra DB read.

---

↑ [Back to README](../README.md)

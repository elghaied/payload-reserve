# payload-reserve Skills

## Installation

```bash
npx  skills add elghaied/payload-reserve
```

## Included Skills

### payload-reserve

Expert guide for the `payload-reserve` Payload CMS 3.x reservation/booking plugin.

**Covers:**

- Plugin configuration and setup
- Collection schemas (Services, Resources, Schedules, Reservations, Customers)
- Customers auth collection (dedicated auth, no admin panel access)
- Resource owner multi-tenancy
- Staff scheduling & auto-provisioning (`staffProvisioning`), time-off / leave management
- Guest (account-less) bookings and cancellation tokens
- Multi-resource bookings and required resource pools
- Capacity / inventory (`quantity`, `capacityMode`)
- Status state machine and hook behavior
- Conflict detection and buffer times
- Frontend booking integration (Local API and REST — 6 endpoints)
- Stripe payment integration
- Notification hooks
- Scheduled cleanup for stale reservations
- Admin components (Calendar with lanes/pending + availability shading, availability-aware time picker, Dashboard Widget, Customer Picker, Availability Grid)
- Internationalization (12 bundled admin-UI locales)
- Troubleshooting common issues

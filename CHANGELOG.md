# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2025-06-01

### Added

- 4 collections: Services, Resources, Schedules, Reservations
- User collection extension for customer fields (name, phone, notes, bookings)
- Reservation hooks: conflict detection, status transition validation, cancellation policy enforcement, automatic end time calculation
- Admin UI: Calendar view (month/week/day), Dashboard widget with today's stats, Availability overview grid
- i18n support (English and Arabic labels)
- Configurable collection slugs, access control, and admin grouping
- `disabled` option to bypass the plugin entirely

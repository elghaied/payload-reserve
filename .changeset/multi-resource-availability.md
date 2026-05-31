---
'payload-reserve': minor
---

Multi-resource availability: a service can now declare `requiredResources` (e.g. a shared chair pool) that every booking of it occupies. Slot discovery (`getAvailableSlots`, `/api/reserve/slots`, `/api/reserve/availability`) intersects the schedules and capacity of all required resources, and bookings are auto-expanded into `items[]` so conflict detection blocks a booking when any required pool is full. Adds a descriptive `resourceType` field to Resources.

Fixes a latent bug where conflict detection counted only a reservation's top-level `resource` and ignored resources held in `items[]` (and multi-resource bookings now receive a top-level `endTime` span). Existing multi-resource deployments will start correctly rejecting bookings that previously slipped through as silent double-bookings. Single-resource deployments are unaffected. Postgres deployments must run a migration for the new fields.

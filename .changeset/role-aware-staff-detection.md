---
'payload-reserve': patch
---

Fix staff/admin detection in single-collection deployments. When `userCollection` is set, customers and staff share one auth collection, so the previous `req.user.collection === slugs.customers` check could never identify staff — breaking admin-only behavior. A new role-aware check (collection first, then `resourceOwnerMode.adminRoles ∪ staffProvisioning.staffRoles`) fixes:

- creating reservations with a non-default status (e.g. `confirmed`) as staff/admin (`validateStatusTransition`)
- the customer search endpoint returning 403 to staff (`/api/reserve/customers`, used by the CustomerField)
- cancellation permission for staff/admin (`cancelBooking`)

The customer search also now excludes privileged-role users from results in single-collection mode, so the customer picker lists only actual customers. Two-collection deployments are unaffected (behavior is identical).

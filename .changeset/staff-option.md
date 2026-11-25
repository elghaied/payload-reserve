---
'payload-reserve': minor
---

New `staff` option for `userCollection` mode (`staff: { roleField: 'roles', roles: ['admin'] }`, or `staff.isStaff`) so admins who share a collection with customers are recognised as staff without `resourceOwnerMode`/`staffProvisioning`; the boot setup check warns when `userCollection` has no staff rule. Fixed: staff detection now matches `resourceOwnerMode.adminRoles` against `resourceOwnerMode.roleField` (it read `staffProvisioning.roleField`).

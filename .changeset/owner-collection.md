---
'payload-reserve': patch
---

Fix the Resource `owner` field pointing at the wrong collection in `resourceOwnerMode`. It was hardcoded to `slugs.customers`, so deployments with **separate** `users` and `customers` collections (staff provisioned from `users`) got an owner relationship that pointed at `customers` instead of the staff user. The owner field now relates to `resourceOwnerMode.ownerCollection` if set, else `staffProvisioning.userCollection`, else `slugs.customers` (unchanged for single-collection / customer-owned setups). Adds an optional `resourceOwnerMode.ownerCollection` to override explicitly.

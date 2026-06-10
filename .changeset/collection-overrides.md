---
'payload-reserve': minor
---

Add `collectionOverrides` — per-collection overrides for the generated collections (`services`, `resources`, `schedules`, `reservations`, and, in standalone mode, `customers`), resolving [#4](https://github.com/elghaied/payload-reserve/issues/4). Each entry is `Omit<Partial<CollectionConfig>, 'fields' | 'slug'> & { fields?: ({ defaultFields }) => Field[] }`: `fields` is a function receiving the plugin's default fields so you can append/reorder/replace them (e.g. add a `join` field on Services pointing back at Resources). The plugin's load-bearing behavior is protected — supplied `hooks` are merged with the plugin's (which always run, and run first), `access` composes per operation, and `slug` is ignored (use the `slugs` option). This supersedes `extraReservationFields`, which is now deprecated but still works (it's part of the default fields the reservations override receives).

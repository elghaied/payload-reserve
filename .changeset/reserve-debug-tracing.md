---
'@elghaied/payload-reserve': minor
---

Add an opt-in `debug?: boolean` plugin option that emits info-level `reserve_debug` traces for slot generation and conflict detection. Every silent empty-return in `getAvailableSlots`/`checkAvailability` now logs its exact reason and inputs, per-stage candidate counts are logged on success, and previously-swallowed `bufferFor`/`getExternalBusy` errors become visible — each line carries a per-call `traceId` so one call's whole trace is greppable. Off by default; no output and no overhead when disabled.

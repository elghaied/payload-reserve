---
'payload-reserve': patch
---

Calendar week/month columns no longer widen to a long event pill's text (`repeat(7, minmax(0, 1fr))` + `min-width: 0` on cells); pills ellipsize inside their day, so the week no longer overflows the viewport when reservations have long titles.

---
name: composer-flicker
description: Phone assistant composer blinked on every settings tap; fixed in PR #244 (merged into dev 2026-10-21), API stops bumping revision on settings
metadata:
  type: project
  modified: 2026-10-21T05:57:20.292Z
---

Thread "composer flicker" (2026-10-21, Poteto-mode). User: "When ever i tap a button its flickering" on the phone assistant composer (saved chat).

Cause: in a saved chat, Search / Add screen / chip remove / model pick went through the one shared chat mutation, so every composer button dimmed and the text box locked for the PATCH round trip; the change only showed after the server answered. The PATCH also bumped `revision`, which made the phone refetch ~12 app-wide queries per tap.

Fix: PR #244, merged into dev 2026-10-21 15:25 UTC by the thread on the user's "Yes merge it" (CI api + node green). Not tested on a real phone yet.
- API `configure` (PATCH /chats/:id) keeps `revision` (`save` vs `change` in service.go; test TestIntegrationSettingsKeepRevision). Phone and desktop must be updated together; an older desktop API still bumps (no blink, just the old refetch).
- Phone: settings save through their own TanStack mutation (`mutationKey ["chat-settings", uid, id]`), shown from `useMutationState` pending variables over the saved chat; shared action mutation and settings share `scope: chat:<id>` so Send waits for a save. Helpers in apps/mobile/lib/chat/settings.ts.
- `make audit-mobile-assistant` now checks no dimming, instant toggle, close/reopen mid-save, failed save, send order.

Offered, not done: app-wide AnimatedPressable press dim snaps to 0.84 instantly (could ease it); real-phone test (needs the PC, ask first per [android-testing-on-user-pc](android-testing-on-user-pc.md)).

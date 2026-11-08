---
name: phone-chat-screen-context
description: PR #173 (merged 2026-10-15): phone assistant new chat always takes the current screen's context
metadata:
  type: project
---

Thread "In mobile the new chat is not taking the screen context". PR #173 (fix/phone-chat-screen-context-povbtm -> dev), merged 2026-10-15.

- Causes: a pinch reused the first unused draft (stale context); screens keyed chips by usePathname() (global path) so a left tab filed its chips under the next tab; New chat inside the assistant had no context; calendar chip sent dayKey (0-based month).
- Now: `draftForScreen` in apps/mobile/lib/chat/context.ts (tested in scripts/mobile-assistant.test.mjs); `useAssistantScreen` registers by owner with `navigation.isFocused()`, provider picks the focused one at pinch time.
- Real-phone check pending on the user. Shots /mnt/project-files/phone-chat-context/.
- Gotcha: Expo web in the cloud container doesn't persist the assistant cache (expo-file-system) and doesn't hot-reload; restart Metro after edits.

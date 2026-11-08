---
name: phone-model-names
description: Thread "Fix missing model names on phone" (2026-11-03): phone Chat model sheets showed only eye icons; fixed in PR #277, merged into dev 2026-11-03
metadata:
  type: project
  modified: 2026-11-03T22:34:20.793Z
---

2026-11-03 thread "Fix missing model names on phone": the user's phone (dark) showed Settings → Agent "Chat model" sheets for OpenRouter and API providers with only vision eye icons, no names.

- Cause: SheetOption (apps/mobile/components/ui/BottomSheet.tsx) wrapped children in <Text> only when `typeof children === "string"` (since #215, 2026-10-17). agent.tsx ModelPicker passed {name}{" · id"}{" · note"} (an array), so the strings went into a View, which Android does not draw. The "Use “…”" typed-name row was blank too. Chat composer ModelSheet was fine.
- Fix: lib/plainText.ts isPlainText(); SheetOption gained `detail` (muted 2nd line) and `trailing` (before the tick); both phone model pickers show name + id, vision eye on the right like desktop. Test: `make test-mobile-plain-text`.
- PR #277 (user opened it from the Claude Code UI) MERGED into dev 2026-11-03 23:44 (no migration, no API restart). Real-phone check not done (needs user's words for `make install-apk`).
- Evidence: /mnt/project-files/phone-model-names/ (compare-*-{light,dark}.png, before/, after/, reports).

**Why:** names missing made the model picker unusable on the phone.
**How to apply:** follow-ups go on a fresh branch. Expo web hides this bug class: see [cloud-env-testing](cloud-env-testing.md) (phone-rule simulation).

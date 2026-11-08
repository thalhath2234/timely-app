---
name: animated-logo-spinners
description: User wants the animated Timely logo used wherever a spinner would be (web, desktop boot screen, mobile); PR #112 merged into dev 2026-10-08
metadata:
  type: feedback
  modified: 2026-10-08T15:56:34.861Z
---

2026-10-08 thread "Animated icon in desktop app" (PR #112 merged into dev): the user said to use the animated Timely icon wherever there is a spinner. The web app already used `LogoSpinner`/`LogoLoader` (apps/web/app/_components/_ui/timelyLogo.tsx). PR #112 added it to the desktop startup screen (apps/web/electron/boot.html, which has an inline copy of the mark and the tl-bar keyframes) and to the last mobile spots (Auto-schedule banner, chat history, header pill, change cards).

**Why:** brand consistency; the user doesn't want generic spinning rings.
**How to apply:** for any new busy state use `LogoSpinner` (web: `tone="mono"` on primary buttons; mobile: `color`), never `Loader2`/`animate-spin`/`ActivityIndicator`. If you change the mark's shape or timing, update boot.html's copy too.

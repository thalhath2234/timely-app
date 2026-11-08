---
name: files-page-ui-pr-164
description: PR #164 (merged 2026-10-12, thread "Fix these ui errors"): Files page archived toggle, tab-strip scrollbar root cause (unlayered CSS), kit Select inline variant, phone callout sheet
metadata:
  type: project
  modified: 2026-10-12T13:44:51.953Z
---

PR #164 fix/files-page-ui-bmri6k -> dev, opened 2026-10-12 from the user's screenshot of the desktop Files page; MERGED into dev 2026-10-12.

- Follow-up in the same PR (user: "remove title from callouts"): no title field on desktop or phone; a title already in a doc (imported `> [!NOTE] Title`) is kept and shown as plain text. Asked whether to hide those too, no answer yet.

- Gotcha: apps/web/app/globals.css app-wide scrollbar rules were unlayered, and unlayered CSS beats every Tailwind utility layer, so `scrollbar-none` / `[scrollbar-width:none]` never worked. Now in `@layer base`. Unlayered component CSS (e.g. `.doc-code-lang`) still overrides utilities passed as className.
- Kit Select gained `variant="inline"` (sizes to label, inherits colour) and `SelectOption.icon`. Doc callout kind + code block language use it; the last native selects are gone from web.
- Phone callout kind: WebView posts `calloutKind`, RichTextEditor shows a BottomSheet, sends `setCalloutKind` (no focus). Needs a real-phone look.
- Expo web crashed on `Appearance.setColorScheme` when an account had light/dark saved; guarded in apps/mobile/lib/theme.ts.
- Playwright headless hides scrollbars by default; pass `ignoreDefaultArgs: ["--hide-scrollbars"]` to see them.
- Left alone: the doc body scrolls inside the 720px column, so its scrollbar sits beside the text, not at the window edge.

Critique and shots: /mnt/project-files/files-page-ui/. Related: [design-system](design-system.md), [ui-fault-sweep-pr-153](ui-fault-sweep-pr-153.md).

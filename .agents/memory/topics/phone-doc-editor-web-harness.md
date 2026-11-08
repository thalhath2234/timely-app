---
name: phone-doc-editor-web-harness
description: How to screenshot the phone doc editor (WebView) and its RN menus/sheets on Expo web at 390px with a simulated keyboard; files saved for reuse
metadata:
  type: reference
  modified: 2026-10-13T15:20:37.682Z
---

The phone doc editor (apps/mobile/components/editor/RichTextEditor.tsx + editorHtml.ts) is a react-native-webview page, so it does not run on Expo web as is. Reusable temporary harness (never commit it) in /mnt/project-files/doc-slash-menu/harness/ (2026-10-13, PR #175):
- `webview-web.tsx`: iframe shim for react-native-webview (bridge script injected into the html, events carry `url: "https://localhost/"` or onMessage drops them; iframe shrinks by the fake keyboard height).
- `metro.config.js`: resolves react-native-webview to the shim on web only (copy into apps/mobile/, the repo has none).
- `harness.tsx`: copy to apps/mobile/app/harness.tsx; open /harness. Monkeypatches Keyboard; `window.__kbShow(300)` / `__kbHide()` fake the keyboard and draw a grey block.
- `shoot.cjs`: Playwright flow (PW=<repo>/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright, chromium /opt/pw-browsers/chromium).
Add the three paths to .git/info/exclude. Expo web does not hot-reload in the container: kill the `node .../expo/bin/cli` pid and restart with `--clear` after each edit (don't pkill -f "expo start": it kills your own shell).
Limit: Yoga-only layout bugs (e.g. flex: 1 Text in a column, see the Delete row fix) don't reproduce on web.
Related: [help-me-write](help-me-write.md), [design-system](design-system.md).
- Keep the harness doc in state (`onChange={(n) => setDoc(n.content)}`): with a constant `content`, RichTextEditor re-sends it with `__timely.set` and undoes edits. Playwright screenshots can move the WebView caret while an RN sheet is open (2026-11-02).

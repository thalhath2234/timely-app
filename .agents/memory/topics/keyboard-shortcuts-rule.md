---
name: keyboard-shortcuts-rule
description: Timely keeps only two keyboard shortcuts (Ctrl/Cmd+K search, Ctrl/Cmd+Shift+J agent); never add others or key hints
metadata:
  type: feedback
  modified: 2026-10-11T13:14:36.735Z
---

On 2026-10-11 the user said: "remove all the key shortcuts, only keep ctrl + k and the ctrl+shift+j for the agent. remove everything else". This was done in PR #147, commit 6. It removed the global handler (g-chords, c/n, /, x, s), the Inbox T/R/S/Del keys, Today's P, the task panel's C and Ctrl+Enter save, Ctrl+F focus, the help search's /, the editor's Ctrl+D, and the desktop doc/sheet tab keys (Ctrl+T/W/Tab). It also removed every key hint in menus and buttons, and the `Kbd` component.

**Why:** the user wants no app-specific shortcuts besides search and the agent prompt.
**How to apply:** don't add new app shortcuts, `shortcut:` hints on menu entries, or `<kbd>` hints. Standard editing keys are fine: Enter, Esc, Tab, arrows, clipboard, undo, formatting, doc find, / and @ in docs, sheet cell keys, and Ctrl+Enter to post a comment. Ctrl/Cmd+click multi-select is allowed where the user asked for it (2026-10-15: dashboard Card workshop "Pick cells" grid); still no key hints for it. Keep the help article "Keyboard shortcuts" and apps/web/FEATURES.md in step with this. Related: [design-system](design-system.md), [agent-prompt-bar](agent-prompt-bar.md).

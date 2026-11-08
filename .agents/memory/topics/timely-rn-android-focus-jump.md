---
name: timely-rn-android-focus-jump
description: RN 0.86 Android moves focus to the first TextInput on screen (the sheet title) when a focused TextInput unmounts; blur before unmounting
metadata:
  type: project
  modified: 2026-10-03T19:01:47.405Z
---

In the Expo mobile app (RN 0.86), unmounting a focused `TextInput` on Android makes the OS reassign focus to the first focusable `TextInput` in the tree. On the sheet screen that is the title field, so the caret appeared in the title after tapping a cell while another cell was being edited (reported 2026-10-03). React Native no longer overrides `requestFocus(direction, rect)`; `clearFocusAndMaybeRefocus` only blocks refocus on API <= 28, and view removal always calls `rootViewRequestFocus()`.

**Why:** the symptom looks like a stray autofocus and is easy to misattribute to the web grid, which handles focus correctly (verified with real clicks on 4002).
**How to apply:** any transient `TextInput` (cell editor, rename fields, inputs inside `BottomSheet`) must be `blur()`ed via a ref before the state change that unmounts it; the mobile `SheetGrid.commitEdit` and the tab-rename sheet do this. See [timely-worktree-qa-environment](timely-worktree-qa-environment.md) for the QA setup.

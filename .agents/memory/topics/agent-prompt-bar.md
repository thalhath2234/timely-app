---
name: agent-prompt-bar
description: Quick prompt (Ctrl/Cmd+Shift+J bar at bottom center) and the Activity island pill in the sidebar (PR #111, 2026-10-08)
metadata:
  type: project
---

2026-10-08 thread "Compact agent prompt": the user asked that the quick chat overlay (they call it Ctrl+J; the real shortcut is Ctrl/Cmd+Shift+J in chatRuntime.tsx) open as just the input box with context chips, image attach, Web search and model picker. No header, no sample prompts, no blurred backdrop. Later (same day) the user asked that sending hand the chat to an "Activity island": a Dynamic Island style pill above Sign out in the sidebar (activityIsland.tsx) that tracks running/waiting Agent runs, task focus and Auto-schedule, opens into a list, and bounces when a run finishes. Both terms are in CONTEXT.md. PR #111 against dev does this on web and desktop. The /chat page keeps its hero, and mobile is unchanged.

**How to apply:** the bar is `Conversation variant="overlay"` with no id, plus `Composer variant="bar"`; the bar sits at the bottom center (user ask); sending morphs it into the island, and a chat opened from the island shows as a panel in the same dialog. `scripts/audit-chat.cjs` (web on :4002, mocked API) checks it and now mocks /agent/providers. App's Reduce motion setting defaults ON (localStorage timely.reducedMotion), which disables the island morph/bounce; the audit turns it off. Island follows app theme (bg-popover), spring open/close, animated logo while a run works, Dismiss/Stop inside each row, hidden-sidebar setting keeps the reply in the panel (user asks + CodeRabbit fixes). PR #111 merged into dev 2026-10-08. Related: [chat-model-picker](chat-model-picker.md)

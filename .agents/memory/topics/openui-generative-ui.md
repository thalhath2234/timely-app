---
name: openui-generative-ui
description: Thesys OpenUI (generative UI) in Timely: package findings, what was built (reply cards, described dashboard cards), PR #250
metadata:
  type: project
  modified: 2026-10-26T05:41:34.908Z
---

Thread "Bring OpenUI into Timely" (2026-10-25..26). "Open ui" = **Thesys OpenUI** (github.com/thesysdev/openui, MIT): the model writes OpenUI Lang, the apps render it with their own registered components; no model HTML/JS runs.

Package findings (@openuidev/lang-core + react-lang v1.0.1):
- react-lang has a React Native entry; peers react 19 + zod 4 (repo has both).
- Prompt comes from the library (`library.prompt`); the Go API can't run it, so `make gen-genui-prompt` writes genui_prompt.txt and go:embeds it.
- lang-core postinstall sends install telemetry to PostHog: blocked with `allowBuilds: "@openuidev/lang-core": false` in pnpm-workspace.yaml. react-lang loads a devtools widget from jsdelivr only under NODE_ENV=development.
- Skip @openuidev/react-ui (16 MB, stock look) and OpenUI Cloud (paid). Components come from Timely's kit [design-system](design-system.md).
- Chat replies arrive whole (no streaming); streaming could come with the SSE work [chat-polling](chat-polling.md).

User's picks: rich agent replies + AI dashboard cards (2026-10-25 22:52); style **1 grouped cards** over wide boards (2026-10-26 03:00).

Built on `feature/openui-agent-replies`:
- Reply cards: one Card of grouped rows per answer, plus Choices chips ("Tapping one sends it as your answer."). Gated by client `ui: "openui-1"`, which sets the conversation's `rich_ui`. ADR 0013.
- Described dashboard cards: "Describe a card" in Add a card. `POST /agent/dashboard-card` writes a program once; `@Data({...})` reads the dashboard's data (packages/contract genuiBoard.ts `drawBoard`). Saved as a custom card + `query.described`. ADR 0014.
- The phone evaluates props itself (drawBoard), because react-lang's Renderer draws DOM.

Testing: e2e against the real API + Postgres with a stand-in model [cloud-env-testing](cloud-env-testing.md). PR #250 into dev opened 2026-10-26 ~04:05 on the user's word ("Test it thoroughly. After that open pr"); CI green. Proof /mnt/project-files/openui/replies/grouped/ and /mnt/project-files/openui/cards/.

Doc live blocks came next, on a stacked branch: [openui-doc-live-blocks](openui-doc-live-blocks.md).

@AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### pstack

Cursor's pstack plugin (poteto-mode, how, why, arena, interrogate, the principle skills and the rest) is vendored in `.agents/pstack` for sessions that can't install plugins, such as cloud project threads. `make pstack-sync` updates it; never edit it by hand.

- When a message asks for a pstack skill (`/poteto-mode`, `/why`, "arena this") that isn't already loaded, read `.agents/pstack/docs/harness/claude-code.md` once, then read `.agents/pstack/skills/<name>/SKILL.md` and follow it. These skills aren't registered with the Skill tool, so reading the file is how they run.
- In this copy `<pstack>` is `.agents/pstack`, the `poteto-agent` and `comment-sicko` subagents are the files in `.claude/agents/`, and the user types `/<name>`, not `/pstack:<name>`.
- Where pstack conflicts with this repo's rules or the user's instructions, such as opening or merging a PR without asking, the repo and the user win.

---
name: pstack-in-cloud
description: How Cursor's pstack skills (poteto-mode etc.) reach cloud project threads, and why the plugin route fails
metadata:
  type: project
  modified: 2026-10-21T14:59:26.931Z
---

- Project threads do NOT install plugins enabled in the repo's `.claude/settings.json` (pstack@cursor-plugins, added in #233); only claude.ai-account plugins load. So pstack is vendored instead.
- 2026-10-19: branch `feature/pstack-skills-m1tyme` copies pstack 0.15.28 verbatim to `.agents/pstack` (56 skills, playbooks, scripts), links poteto-agent/comment-sicko in `.claude/agents/`, adds `make pstack-sync` (scripts/sync-pstack.sh) and a CLAUDE.md "pstack" section. User chose repo over account skills. PR #235 merged into dev 2026-10-19 13:43 UTC on the user's "merge it"; threads started after that have pstack.
- How it runs: pstack skills have `disable-model-invocation`, so they are not registered; CLAUDE.md tells the thread to read `.agents/pstack/skills/<name>/SKILL.md` when the user types `/poteto-mode`, `/why`, etc. Verified with a fresh headless session (routed to Bug fix playbook). Repo/user rules win over pstack (PR/merge confirmation).
- Update with `make pstack-sync`; never hand-edit `.agents/pstack`.
- In cloud threads (seen 2026-10-21, composer flicker thread): `poteto-agent`/`comment-sicko` are not registered agent types, so threads spawn general-purpose agents that read `.claude/agents/<name>.md`. `.claude/rules/pstack-models.md` sets every role to `opus high`, so /interrogate's two reviewers are the same model (no model diversity). `deslop` and `control-ui` (cursor-team-kit) are not vendored; threads skip them and say so. The user asked "What did the poteto-mode skill actually did", so threads should list each step run and each skip in the reply.
- Cloud sessions have no `/plugin` and no marketplace plugins; only account plugins/skills (none enabled, 2026-10-19) and repo skills.

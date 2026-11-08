---
name: test-on-user-dev-server
description: User lets Claude test branches on their PC's running make dev server by checking out the branch there (hot reload)
metadata:
  type: feedback
  modified: 2026-10-09T03:18:01.510Z
---

2026-10-09 (Jev thread): the user said to test on their computer using their already-running `make dev` server (API 8080, web 4001) by checking out the new branch in their checkout (/home/thalhath/Dev/timely-app); it hot-reloads. Their OpenRouter key is already saved in that dev account.

**Why:** simpler than a separate worktree on 4002/8081, and their real account/keys are there.
**How to apply:** this is a per-ask exception to the AGENTS.md "never touch 8080/4001" rule; only do it when the user asks. Check `git status` there first and don't discard their uncommitted work; switch back to their previous branch afterwards. Use Remote Control or the folder tools.

Limit found 2026-10-09: the folder tools' shell (device_bash) can't reach GitHub (ssh and https both refused) and can't write into .git, so it can't fetch a new branch. Ask the user to run `git fetch && git checkout <branch>` themselves, or use a Remote Control session.

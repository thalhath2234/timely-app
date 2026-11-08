---
name: cloud-dev-server-watchers
description: In the cloud container, Next dev and Expo/Metro do not pick up file edits; restart the dev server after editing before screenshots
metadata:
  type: project
  modified: 2026-10-11T15:45:24.939Z
---

In the cloud "timely" environment, `next dev` (web :4002) and `expo start --web` (:8082) keep serving the bundle from when they started: edits made after start never reach the browser (seen 2026-10-11 in thread "UI fault sweep", after screenshots showed old code twice).

**Why:** the file watchers do not fire in the container (inotify limits / fs), so hot reload never triggers.

**How to apply:** after editing web or mobile code, kill the dev server by pid (not `pkill -f "next dev"`, which also kills the shell running the restart) and start it again (`--clear` for Expo) before taking screenshots or testing; confirm by grepping the served bundle for a new identifier. See [ui-fault-sweep-pr-153](ui-fault-sweep-pr-153.md).

Also (2026-10-25, "Repeated /chat requests" thread): after the container is reclaimed and restarted, a fresh `next dev -p 4002` answered every page with 404 (stale Turbopack cache). `rm -rf apps/web/.next/dev` and restart fixed it. Postgres under /var/tmp and the API need starting again too.

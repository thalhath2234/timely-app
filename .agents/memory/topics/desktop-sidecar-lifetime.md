---
name: desktop-sidecar-lifetime
description: Why desktop Timely left next-server/postgres running (OOM crashes on Arch) and how PR #165 keeps sidecars from outliving the app
metadata:
  type: project
---

2026-10-12, thread "Desktop server left running after close": the user hit 9 OOM crashes (some took down Hyprland). Cause: when Electron died abruptly (OOM kill, compositor crash) the Next server and postmaster survived; each later boot picked a new web port beside the leftover, which kept its ~3 GB. The Go API died on its own via SIGPIPE on its log pipe. Evidence pattern in supervisor.log: a "boot:" line with no "shutdown" before it, then "postmaster from an earlier run is still alive" and a new web port.

PR #165 (into dev): stdin lifeline for API + Next (TIMELY_LIFELINE=stdin, next-guard.cjs staged as next-server/timely-guard.cjs), setpriv --pdeathsig on Linux for all three, Windows relies on libuv kill-on-close job, Linux boot sweep via /proc (program + JWT secret / data dir), Next heap cap 1024 MB + 1.5 GB RSS / heap-full guard (exit 75, supervisor restarts). Independent reviewer agent reviewed; its items were fixed. Root cause of the 3 GB growth itself was NOT found (load tests stayed < 300 MB).

Follow-up offered: agent CLIs get the API's full env incl. JWT_SECRET/DB_PASSWORD (pre-existing). Release needed after merge (see [release-flow](release-flow.md)). Related: [desktop-local-builds](desktop-local-builds.md).

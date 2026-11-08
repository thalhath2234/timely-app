---
name: desktop-local-builds
description: Local desktop builds are "Timely Dev" (own data folder, lock, ports); only release.yml (TIMELY_RELEASE=1) builds "Timely"
metadata:
  type: project
  modified: 2026-10-08T13:50:19.766Z
---

PR #101 merged into dev on 2026-10-08. A locally built desktop app used to hand over to the installed release, because Electron allows one running copy per userData folder and both used <appData>/Timely.

Now every build except release.yml (which sets TIMELY_RELEASE=1) is "Timely Dev":
- executable `timely-dev`
- userData `~/.config/Timely Dev`
- ports 54339/48090/44011
- "(Dev)" at the end of the window title
- no updater

On Arch the user runs `apps/web/release/linux-unpacked/timely-dev`. `TIMELY_RELEASE=1 make dist-desktop` builds a release-identical installer.

Code: apps/web/electron/flavor.ts, electron-builder.local.yml. Docs: docs/desktop/README.md "Local builds".

**Why:** the user tests local builds on the same PC where the release is installed.
**How to apply:** if a release build ever comes out named "Timely Dev", check that TIMELY_RELEASE is still set in release.yml.

2026-10-08: after upgrading, v0.2.1 showed a white screen on Arch because the old AUR 0.1.2 (/opt/timely-bin) was still running in the tray and kept the single-instance lock. Quitting it from the tray fixed it. If a new release looks broken, check its supervisor.log for a boot line before assuming the build is bad. A Timely Dev window once rendered with no CSS, and that never reproduced: the build and the served CSS were fine.

Unexplained: once in this thread, the first `make build-desktop` overwrote apps/web/package.json with the packaged version. Three later builds did not do it. If it shows up again, `git checkout apps/web/package.json`. Related: [release-flow](release-flow.md).

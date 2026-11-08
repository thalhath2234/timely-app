---
name: arch-distribution-options
description: Arch Linux distribution for Timely: pacman package on releases (branch feature/pacman-package), options weighed, timely-bin missing from the AUR
metadata:
  type: project
  modified: 2026-10-21T15:26:22.532Z
---

2026-10-20, thread "Arch Linux distribution options": user asked about other ways to ship on Arch; recommended (1) pacman package on each release + (2) Chaotic-AUR request. User said "I want to setup packman" -> built option 1.

PR #246 (feature/pacman-package) MERGED into dev 2026-10-21 on the user's "Merge it"; ships from the next release tag (check the .pacman is on that release):
- electron-builder.yml linux.target += pacman; pacman block: packageName timely, explicit depends (defaults name http-parser and libappindicator-gtk3, gone from Arch), fpm --description override (default starts with a newline -> empty Description), fpm --after-upgrade electron/pacman/after-upgrade.sh (re-applies setuid chrome-sandbox; electron-builder only does it on install). extraMetadata homepage + license MIT (fpm needs homepage). Local yml: packageName timely-dev.
- release.yml installs libarchive-tools (fpm needs bsdtar) and uploads *.pacman. xz compression kept (219 MB vs zstd 310 MB; xz takes ~8 min).
- Artifact Timely-X.Y.Z-linux-x64.pacman listed in latest-linux.yml next to the AppImage; AppImage has no package-type (async targets build before fpm).
- Tested in an Arch bootstrap chroot in the cloud container: swaps out timely-bin (conflicts=timely), boots, Check for updates works, self-update 0.3.4 -> fake 0.3.5 via local generic server installed with pacman and relaunched. Container lacks user namespaces, so relaunch only worked with --no-sandbox there (setuid sandbox blocked relaunch); normal Arch kernels use the namespace sandbox. Not yet tested on the user's real PC or a real tagged release.
- Command is /usr/bin/Timely (capital T) for the pacman package vs timely for timely-bin.
- Shots: /mnt/project-files/pacman-package/.

FINDING: timely-bin is NOT on the AUR (aur.archlinux.org/packages/timely-bin 404, RPC 0 results, 2026-10-20) although help/README point there. Told the user.

**Why:** open source, nothing may cost users money; keep in-app updates for Arch users.
**How to apply:** after the PR merges, the first tagged release is the real CI check (bsdtar step, upload). See [release-flow](release-flow.md).

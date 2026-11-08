---
name: release-flow
description: How Timely releases go out, what Claude can do vs the user, release history and AppImage sha256s
metadata:
  type: project
  modified: 2026-10-19T21:24:54.602Z
---

Steps are in package.md. Version lives only in apps/web/package.json.

- Flow: one bump PR into dev that also moves packaging/aur/timely-bin PKGBUILD + .SRCINFO (_tag, _ver, pkgver, URL; pkgrel=1) with the AppImage sha256 = SKIP; then a dev -> main PR titled "Release vX.Y.Z". Main merge commit title MUST be "Release vX.Y.Z" (pass commit_title). It went wrong twice: #156 (v0.3.2) and #238 (v0.3.4, the user clicked Merge in GitHub before the thread did), both got "Merge pull request #N from thalhath2234/dev". Not fixable without force-pushing main; left as is.
- A thread can merge both PRs itself once CI (api, node) is green; neither is stacked. ci.yml runs on every pull_request and on pushes to dev.
- The user creates the tag/release on GitHub; threads can't push tags. The tag runs release.yml (prepare checks tag == package.json version). release.yml sets TIMELY_RELEASE=1 on the desktop job (else builds come out "Timely Dev").
- After the tag's build: replace SKIP with the real AppImage sha256 (GitHub asset digest) on dev and main (one branch cut from main, two PRs); the user pushes to the AUR.
- Android keystore secrets (ANDROID_*) unset: the workflow warns and signs with the debug key, it does not fail.
- macOS dropped from releases 2026-10-08 (#107).
- Gotcha: a migration dated before dev's newest makes goose fail on existing DBs ("found 1 missing migrations"); check order (and landing order) before releasing.
- Notes per release: /mnt/project-files/releases/vX.Y.Z-notes.md (v0.3.3 also has v0.3.3-checks.md).

History (AppImage sha256):
- v0.2.1 2026-10-08 (#103/#104; AUR #105/#106) 8ac54e02e8fb49a1aac2e39a99b193378ca11e71255ffc77f58fcf2a3af083f8
- v0.3.0 2026-10-11 (#135/#136) f85237f4520a3b49c3471f9997069a3436d55d2803be4d7745b11f565e3ada63
- v0.3.1 2026-10-11 (#140/#141; AUR #143/#144) a00673ef5c497ddcf4b9ebd3ac40535423f86efa7266f525c94d17e77d0a519e
- v0.3.2 2026-10-11 (#155/#156; tagged on dev's #155 merge) cb08df2406a31ffb527a4d08de0fc9e257d1a23568ea08ae7d0433c3504673d1 (never put in PKGBUILD)
- v0.3.3 2026-10-13 (#167/#168; AUR #169/#170) ed4c42d5ff2c0471d46a0d382bf580b7ec12a36881b14f4c404b17bcb2fc3bba
- v0.3.4 2026-10-19 (#237 bump, #238 dev->main merged by the user; covers #171-#236). Tag pending at 21:25 UTC; then SKIP -> real sha256 on dev and main.

Related: [desktop-local-builds](desktop-local-builds.md), [stacked-prs-merge](stacked-prs-merge.md).

v0.3.5 so far (merged into dev): #239 predictive back 32dp, #240 board card size, #241 recurring done per occurrence, #242 edit custom cards/widgets, #243 sharp phone motion loops (2026-10-20); #244 composer flicker, #245 phone calendar ticks and lag, #246 pacman package (2026-10-21); #247 phone doc Select all + keyboard delete, #248 runtime API_ORIGIN + Docker web image, #249 make dev-api through devtap (2026-10-23); #259 chat changes pushed over one SSE stream (2026-10-31, API restart runs its migration). The .pacman file is not yet built by Actions.
- AUR: `timely-bin` page gives 404 (pacman thread, 2026-10-20, still missing 2026-10-21), so the AUR install steps don't work right now; the user may never have pushed it or it was removed.
- v0.3.4 prepared 2026-10-19 (#237 bump; #238 dev->main merged by the USER, default title kept; notes /mnt/project-files/releases/v0.3.4-notes.md). After the tag build, swap SKIP sha256 for the real one on dev and main. Other version fields not synced; offered, no answer.
- Next release (v0.3.5): #239-#249 merged into dev 2026-10-20..23 (list in the topic file), then #250-#252 (OpenUI replies, cards, doc live blocks) 2026-10-26, then #254 (sheet value match, Describe tools, doc checklists) 2026-10-30, then #255 (checklist task offers via Jev, suggestions need a key) 2026-10-31, then #257 and #259 (Help me write fixes, chat status stream) and #260 (grouped agent review, per-card apply/discard) 2026-10-31. After the next tag, check the release assets include the .pacman file.

v0.3.5 PREPARED 2026-11-06 (thread "Release v0.3.5"): #279 bump merged into dev (feature/release-v0.3.5, PKGBUILD/.SRCINFO at 0.3.5 with SKIP), #280 dev->main merged by the thread with commit title "Release v0.3.5" (main c887bbe, title correct this time). Covers #239-#278 (8 migrations, API restart; users must pick a default AI provider in Settings -> Agent, ADR 0020). Notes /mnt/project-files/releases/v0.3.5-notes.md. WAITING: user tags v0.3.5 on main; then real AppImage sha256 into PKGBUILD + .SRCINFO on dev and main (two PRs) and check the release has the .pacman asset. v0.3.4 sha256 follow-up is moot (replaced by 0.3.5 SKIP). AUR timely-bin 404 not rechecked.

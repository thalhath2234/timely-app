# Timely project memory

Shared memory for every agent working in this repo (Claude Code, Codex, OpenCode, any other). Its rules bind like `AGENTS.md`; how to read and update it is in the root `AGENTS.md` under "Project memory". Status lines are snapshots: check the code, git and GitHub before acting on one.

Most entries came from the Claude "Timely App" project (October to November 2026, exported 2026-11-08), which used its own vocabulary:
- A "thread" is one project conversation; the "coordinator" or "channel session" ran the project chat and briefed threads; the "cloud env" is the Claude Code on the web container; "Remote Control" is a Claude session running on the owner's PC. Tool names such as `message_thread`, `rc_session_status` or `list_project_prs` belong to that setup: use git and `gh` directly.
- Paths under `/mnt/project-files/` are that project's shared Library, not this repo or the PC.
- "The user" or "owner" is Thalhath (GitHub `thalhath2234`).

## Timely App
- Owner: Thalhath (GitHub thalhath2234), personal, non-commercial project; the repo https://github.com/thalhath2234/timely-app is PUBLIC, so memory holds no secrets. Prefers setup from the app UI, env vars only as fallbacks; host features go in the Go API so the phone gets them [timely-personal-use-ui-setup](topics/timely-personal-use-ui-setup.md). Goal: v1 soon. Open source: features must not require users to pay (e.g. a domain).
- Project instructions: branches feature/ or fix/, never claude/ (coordinator passes outcome_branch); design skills for UI changes; dev->main release merge commit titled "Release vX.Y.Z"; Remotion skills for animations (brief animation threads with this).

## How the user wants work done (brief every thread with the capitalised rules)
- NO PR WITHOUT CONFIRMATION (user 2026-10-17/18): push the branch, show proof, ask; open the PR only when the user says so. [pr-confirm-rule](topics/pr-confirm-rule.md)
- DESIGN SKILLS for every UI change, however small; verify after with screenshots. Likes several numbered options to pick from. Dislikes empty space on wide screens and "generic" designs. Design sketches as FULL-PAGE PNGs (desktop + phone), not hero crops.
- SCREENSHOTS ALWAYS INCLUDE DARK THEME (user 2026-10-18), attached in the reply itself, not only in a folder.
- SCREENSHOTS MUST PROVE THE FIX (user 2026-10-21): show the bug's own steps before and after (text selected, then gone), not just the final screen.
- GROUPED LAYOUT for every UI change (user 2026-10-17): cards of grouped rows (label left, value/switch right; multi-picks as one summary row opening a list), as in #214 view filter and #216 phone Settings (components/settings/SettingsList.tsx); web kit _ui/groupedList.tsx (#218). [phone-settings-grouped-rows](topics/phone-settings-grouped-rows.md)
- Desktop and phone match Timely design; compact on phone. Timely's own date picker, never native inputs. Build from shared kit (docs/design-system.md; corners 10/12/20) [design-system](topics/design-system.md).
- Shortcuts: ONLY Ctrl/Cmd+K and Ctrl/Cmd+Shift+J, no key hints. Desktop Ctrl+W closes window. Exception: Ctrl/Cmd+click multi-select in Card workshop cell grid. [keyboard-shortcuts-rule](topics/keyboard-shortcuts-rule.md)
- Models: no Fable unless the user asks ("use fable" = switch to Fable 5.1). No `adversary` subagent: review diffs yourself (user 2026-10-09, overrides the global adversary-before-PR rule) [no-adversary-no-fable](topics/no-adversary-no-fable.md).
- "Poteto-mode" = run the repo's /poteto-mode (.agents/pstack/skills/poteto-mode/SKILL.md) FULLY; the user checks afterwards. Say up front if a step can't run. Cloud gaps: `deslop`/`control-ui` are Cursor-only (Playwright instead); /interrogate's two reviewers both run Opus (repo model config). [pstack-in-cloud](topics/pstack-in-cloud.md)
- CodeRabbit skips repo; Claude reviews diffs. For major problems user may ask for an independent "advisory" review.
- Merges: "merge it" in each PR's own thread; a bare "Merge it" after "open the PR?" = open it and merge once CI is green; "merge it if you tested it" = merge with test evidence. Verify with list_project_prs (sorted oddly). Threads merge non-stacked PRs into dev; stacked merges are the user's. No pushes to dev or tags. Follow-ups after a merge: fresh branch and PR. User sometimes opens the PR from the Claude Code UI (#239).
- User keeps a to-do doc ("Timely v0.3.4") sent as .md + screenshots. Wants interactive things interactive (widgets: timers, tick boxes work in place).
- Reports often don't name the app (layout ones usually mean phone): check both. Screenshots often arrive seconds after the text; forward them. Pinned comments on PNGs in a thread are change requests for that thread.
- Bug reports sometimes arrive as a message.md whose first line is the user's words and the rest a browser HAR export with LIVE AUTH TOKENS (2026-10-19). Read only the head; tell threads never to copy it into files, PRs or replies.
- "Test on my connected phone" = the thread starts a Remote Control session on the PC itself.
- ONE PC/PHONE THREAD AT A TIME (user 2026-10-18; 3 parallel threads took the PC offline). Coordinator releases the next with message_thread when one finishes.
- User has more than one Timely account on the phone; wrong account once looked like lost data (2026-10-18). Check account first when data "disappears".
- "whats next" in a thread = the thread lists what is left as numbered options; "merge this and continue next" = merge, then take the next item on that list; "start now" = take the next item the thread offered.
- AGENT REVIEW CARDS (user 2026-10-31): batched agent changes must read as ONE grouped change, not one card per row; use OpenUI standards for readability but fixed designs per item type (tasks, sheets, docs).

## Environment and testing
- User on Arch (~/Dev/timely-app), `make build-desktop`, `make dev` running; pulls dev for merged changes; migrations need API restart. Phone: `make install-apk` (Xiaomi HyperOS, Android 15; regenerates android/ on config change). PC safety check needs the user's explicit words before `make install-apk` runs and blocks minting a dev JWT.
- Live checks on user's PC: Remote Control or their local Claude Code driving Chrome (demo account, web 4001, API 8080 behind devtap since #249, inspector :9090). User browses with Zen (Firefox); blur flicker doesn't reproduce in headless Chromium, which also has no H.264 encoder.
- Real-phone testing: Remote Control in ~/Dev/timely-app with adb (widgets placed by hand). Phone reaches the server over Tailscale; HyperOS kills Tailscale and Timely (ask for "No restrictions" battery + Autostart). Needs the Timely Dev desktop app running. adb taps don't move like fingers. Watch PC memory (APK build + emulator OOM'd; `make emu-stop`). [android-testing-on-user-pc](topics/android-testing-on-user-pc.md)
- adb install fails when phone memory is low; Blender on PC (no task). Detail in [android-testing-on-user-pc](topics/android-testing-on-user-pc.md).
- Remote Control thread sessions park when idle and sometimes don't restart on the user's next message. If the user waits with no answer, check rc_session_status and nudge with message_thread.
- Cloud env "timely": no emulator, phone tested as Expo web at 390px (CORS_ORIGINS=http://localhost:8082, EXPO_PUBLIC_API_URL=http://localhost:8081, API on 8081). Container dev servers do not hot-reload. Limits and harnesses in [cloud-env-testing](topics/cloud-env-testing.md).
- AI TEST KEYS (user 2026-10-31): cloud env has the user's Claude and OpenRouter keys as env variables; use them to test AI features. CLAUDE: ALWAYS HAIKU, NO OTHER MODEL. OPENROUTER: ONLY for embeddings and Jev. Never paste keys in chat/files.
- PSTACK skills vendored in the repo (#235, `make pstack-sync`); threads read .agents/pstack/skills/<name>/SKILL.md. Detail in [cloud-env-testing](topics/cloud-env-testing.md).
- Worktree QA traps (restart 4002 after `pnpm install`, never `pkill -f apps/api/tmp/main`, `make build-apk` rewrites bundledUrl.ts, pnpm overrides live in pnpm-workspace.yaml) [timely-worktree-qa-environment](topics/timely-worktree-qa-environment.md).
- Live-testing the in-app agent (transcript in Postgres, tools over /mcp) and the 2026-10-02 84-scenario findings [timely-agent-qa-harness](topics/timely-agent-qa-harness.md).
- Desktop bundle and release.yml traps (baked Next rewrites, no pg_dump, electron-builder symlinks, Windows cpSync) [timely-desktop-bundle-traps](topics/timely-desktop-bundle-traps.md).
- Real-phone widget QA on HyperOS (PIN, autoscaled tap areas, Autostart, install prompt, real data on widgets) [timely-hyperos-widget-qa](topics/timely-hyperos-widget-qa.md).
- RN Android moves focus to the first TextInput when a focused one unmounts: blur first [timely-rn-android-focus-jump](topics/timely-rn-android-focus-jump.md).
- Expo SDK 57 (apps/mobile, package com.timely.mobile): Android doesn't resize for keyboard; bottom inputs must lift themselves. Backend Go API.

## Release flow [release-flow](topics/release-flow.md)
- Version in apps/web/package.json. Bump PR on dev, then dev->main PR merged as "Release vX.Y.Z". User tags vX.Y.Z on main -> Win exe, Linux AppImage, Android APK (no macOS), and from the next tag a `.pacman` package (#246). Windows matters most. Then PKGBUILD + .SRCINFO sha256 on dev and main; user pushes AUR (packaging/aur/timely-bin). Guide package.md. Notes /mnt/project-files/releases/.
- AUR timely-bin page 404 since 2026-10-20 (unrechecked). v0.3.4 sha256 follow-up closed by v0.3.5 merge.
- v0.3.5 (thread "Release v0.3.5", 2026-11-06): #239-#278; bump #279 into dev, #280 dev->main merged as "Release v0.3.5" (main c887bbe). WAITING ON USER to tag v0.3.5; then thread puts AppImage sha256 on dev+main and checks .pacman asset. Notes /mnt/project-files/releases/v0.3.5-notes.md. 8 migrations (API restart), users must pick default AI provider.
- Old branches list: /mnt/project-files/releases/old-branches-to-delete.txt (add fix/android-widget-taps). ANDROID_* keystore secrets unset (debug-signed APK).

## v0.3.3 / v0.3.4 [v0-3-4-contents](topics/v0-3-4-contents.md)
- v0.3.3 2026-10-13 (#158-#166); v0.3.4 = #171-#236. PR list, pending phone checks and open offers in the topic file.

## Open threads (2026-10-21 15:27; detail in [open-threads](topics/open-threads.md))
- "Fix flickering frozen sheet headers on phone" (2026-11-06): pinned layers moved to RN native-driver Animated; PR #278 MERGED into dev 2026-11-06 (no migration), real phone not checked [phone-sheet-frozen-flicker](topics/phone-sheet-frozen-flicker.md).
- "Fix missing model names on phone" (2026-11-03): SheetOption dropped multi-string rows on Android; PR #277 MERGED into dev 2026-11-03 (no migration); real phone not checked [phone-model-names](topics/phone-model-names.md).
- "Design autonomous user-made bots" (2026-11-02): plan doc parts A-G + I [autonomous-bots-plan](topics/autonomous-bots-plan.md) [bots-secure-signin-plan](topics/bots-secure-signin-plan.md) [bots-mcp-plan](topics/bots-mcp-plan.md). User 2026-11-06 20:44: "pick recommended and start building" = recommended options for all parts; BUILDING now in that thread; PRs #281/#282 open; Bots page = Option 2 "Board of cards" (picked 2026-11-07), PR #283 (stacked on #282); branch 4 feature/bots-ai = PR #284 (stacked on #283). User 2026-11-07 "complete everything": branch 5 = PR #285, Part F sign-ins, Part I MCP next, each a stacked PR opened when built. Part I 4 questions all yes (stdio phase 5, CIMD on GitHub Pages, server installs get sign-ins, bot proposals from phase 4). PC harness (old Part H) PARKED [pc-harness-plan](topics/pc-harness-plan.md).
- "Fix doc checkbox alignment and Turn into" (2026-11-02): to-do box centred + TaskCheck look on web/desktop; Turn into for every text block on web and phone; PR #275 MERGED into dev 2026-11-02 21:38 (no migration; real-phone check pending) [doc-todo-turn-into](topics/doc-todo-turn-into.md).
- Older threads (v0.3.4 release, #239-#243 and #247 real-phone checks, composer flicker #244, calendar ticks #245, pacman #246, API URL #248): merged, waiting on user checks; detail in [open-threads](topics/open-threads.md).
- "Finish AI routing follow-ups" (2026-10-31): live block written once + Settings "Automatic" default row, PR #264 MERGED into dev 2026-11-01 02:22 (API restart, no migration) [ai-edge-cases](topics/ai-edge-cases.md).
- "Live-test AI features with both keys" (2026-10-31): 296 findings, all highs/mediums/lows fixed. #265-#273 MERGED into dev 2026-11-01 18:29 (2 migrations, API restart). User's default-provider picks built (ADR 0020). 16 owner questions in the report doc, user answers later [ai-live-test-fixes](topics/ai-live-test-fixes.md) [ai-live-test-harness](topics/ai-live-test-harness.md).
- "Repeated /chat requests" (2026-10-25): web polled GET /chats every 5 s. SSE stream + polling fix #259 MERGED into dev 2026-10-31; the API needs a restart for its migration [chat-polling](topics/chat-polling.md).
- "Bring OpenUI into Timely" (2026-10-26): #250-#252 merged 2026-10-26, #254 merged by the user 2026-10-30 [openui-generative-ui](topics/openui-generative-ui.md) [openui-doc-live-blocks](topics/openui-doc-live-blocks.md) [describe-live-block-tools](topics/describe-live-block-tools.md) [doc-checklist-cards](topics/doc-checklist-cards.md). Open: real-phone test (needs Claude Code 2.1.302+ on PC; Tailscale setup once PC on); design pick (card shows both Left and Done); widget fix PR #258 MERGED into dev 2026-10-31 (real-phone check pending).
- "Fix Help me write checklist context" (2026-10-31): #256 and #255 (checklist task offers) MERGED into dev 2026-10-31 [checklist-task-offers](topics/checklist-task-offers.md). #257 edge cases MERGED 2026-10-31 [help-me-write](topics/help-me-write.md).
- "Stop Help me write duplicating lists" (2026-11-02): AI picks replace/cursor/end, Replace button + Undo; PR #274 MERGED into dev 2026-11-02 (Haiku-tested, API restart, no migration; real phone not checked) [help-me-write-replace](topics/help-me-write-replace.md).
- "Group agent changes for review" (2026-10-31): option 2 (numbers strip + one card open), per-card Apply/Discard plus Apply all/Discard all, doc tick boxes, one chat-header collapse button. #260 MERGED into dev 2026-10-31 [grouped-agent-review](topics/grouped-agent-review.md).
- "Align Make task offers with doc rows" (2026-10-31): user picked "combine 2 and 4"; BUILT and pushed on fix/make-task-offer-alignment (gutter discs + popover, "Not tasks yet" rail card, phone discs + grouped sheet), #261 MERGED into dev 2026-10-31; real desktop/phone check pending; Goes to picker #262 MERGED into dev 2026-10-31 (API restart for migration) [make-task-alignment](topics/make-task-alignment.md).
- "Find all the edge cases where the APIs are used" (2026-10-31): edge-case map doc + AI routing fix #263 MERGED into dev 2026-11-01 (empty default = automatic, OpenRouter last; Haiku defaults; API restart for migration). Follow-ups (live block written twice, settings "automatic" badge) moved to a new thread [ai-edge-cases](topics/ai-edge-cases.md).
- Resolved but with open picks: "Premium look report" picks D and E; "/plugin-authoring" mod offer never picked.

## Design overhaul (#228, thread "Premium look report for the app") [design-overhaul-phases](topics/design-overhaul-phases.md)
- Report artifact 6ba4b068 (link in topic file). OPEN PICKS: D task detail modal vs rail, E phone FAB vs bottom-bar add.

## Web app (merged)
- Landing = Remotion film #227 [landing-and-help-center](topics/landing-and-help-center.md); auth redesign #146 (phone auth always dark); dashboard workshop #137; quick prompt #111; agent keys #134.

## Research
- "Find ways to host Timely" (2026-10-30): 4 ways today (desktop app, docker compose, bare binaries, make dev) plus Docker gaps offered as a fix-up branch, no answer yet [hosting-options](topics/hosting-options.md).
- "Desktop to phone bridge without Tailscale": recommendation B2 (owner buys one Cloudflare domain, free Worker, bundled cloudflared). Waiting on user. /mnt/project-files/desktop-phone-bridge/report.md. User wants Timely's own bridge, no separate app.

## Jev (TypeSafe)
- Typed-question model; TypeSafe API first, OpenRouter fallback; works with no keys. Model: jev-latest on both (OpenRouter `~typesafe/jev-latest`), PR #276 MERGED into dev 2026-11-03 [jev-model-id](topics/jev-model-id.md). Phases 0-9 merged (#120-#131). User does NOT want cheaper model / plan comparison / rechecks / source checks. Ideas /mnt/project-files/jev-ideas/jev-full-list.md. [jev-review](topics/jev-review.md)

## Desktop app
- Bundles PostgreSQL 17 (port 54329). Windows must not run as Admin; per-user installer. Logs ~/.config/Timely/logs/. Close hides to tray; server/MCP/Tailscale stay up until "Quit Timely". Local builds "Timely Dev". Untested on real systems: Windows menu bar (#84), AUR upgrade while running (#139), delete account (#142). Agent CLIs run with --strict-mcp-config; outside agents use Timely MCP over HTTP with an API key.

## Docs / Security
- Goal: full doc <-> .md parity (docs/markdown.md); 3D options offered, no choice.
- Security review 2026-10-05 (/mnt/project-files/security/); highs/mediums fixed. Before v1: bundle mobile editor code, Electron fuses, web CSP, npm build tool updates.

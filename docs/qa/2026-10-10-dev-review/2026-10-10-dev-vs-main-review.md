# Dev vs main review, 2026-10-10

Commit reviewed: `8a7119dd9f012056851285ad729d527a2d0d2d56` (dev, merge of #131).
Baseline: `cb267ddb4a6d3254c15ad7f23dca460eaf98292c` (origin/main, release 0.2.1).
Scope: the 24 merged PRs in the attached review brief. Review only; no product fixes, commits, pushes, tags, or GitHub comments.

## Summary

- Coverage: **24 PRs, 239 check rows** — 112 Pass, 84 Partial, 22 Not checked, 16 Needs owner, 3 Brief outdated, 2 Fail (the failures below).
- New dev findings: **0 confirmed product Blockers, 0 confirmed Majors, 1 Minor**: the repeating-series integration test assumes its returned timestamp is UTC. It fails under Asia/Tokyo and passes under UTC.
- Existing platform blocker: **1 Blocker** for the requested review platform. Expo web crashes before the app loads on both dev and main. This prevents mobile UI verification; it does **not** establish that Android or iOS crashes.
- `make check`: **Pass** after the production build regenerated stale Next.js route types. Main's complete `make check` also passed in a separate archive using the installed workspace dependencies.
- `make test-chat-integration`: **Fail** in this machine's Tokyo timezone; **Pass** with `TZ=UTC`. Main passes in Tokyo. The failing test is new on dev.
- Linux desktop build and bundled startup: **Pass**. Bundled Postgres/API/web started; all migrations applied. MCP initialization worked at the actual browser and desktop addresses. X11 pointer movement to Cancel passed for the shared task-delete dialog.
- Live OpenRouter chat and Jev calls passed. Claude CLI and Codex CLI each completed a live read-only chat. No actual TypeSafe credential was available; its valid-key lifecycle and fallback paths were checked with the existing automated tests.
- Migration upgrade, eight-step downgrade, and re-upgrade passed in a scratch schema. Legacy settings goals migrated in order. Live backup/restore preserved habits, check-ins, goals, and phone views.
- Needs owner: real Windows pointer behavior; real phone UI, doc WebView selection, gestures, background timers/notifications, push navigation, offline synchronization, and sheet new-row hints. Receipt-model accuracy needs representative receipt photos.

**This is not a full release sign-off.** Rows marked Partial or Not checked identify the remaining live scenarios. An automated pass with a stubbed Jev response proves the code path, not the accuracy of the external model or a physical-device interaction.

## Environment, method, and evidence

The existing checkout already matched the requested dev commit and had dependencies, Postgres, API credentials, and providers configured. I preserved its branch and reused the running servers initially. After interruptions the original ports stopped responding; I started my review API on 8081 with `DB_SCHEMA=qa_dev_review_20261010`, and web on 4002. I did not launch or stop servers on 8080/4001. The baseline was extracted to `/tmp/timely-main-review-20261010` without changing this checkout. No dependency versions or lockfiles were changed.

The T3 collaborative preview was used first. Its explicit unavailable/no-automation-host responses required a headless Playwright fallback. The browser context used Asia/Tokyo and 1440×900; responsive web was also checked at 390×844. Responsive web screenshots are **not Expo/mobile-app parity evidence**. No emulator was started. The Linux package ran under Xvfb/X11 with a separate user-data directory; it was not tested on a physical Arch desktop or Windows.

The requested `/mnt/project-files/dev-review/` location is not writable by this user. This report and all retained evidence are instead in `docs/qa/2026-10-10-dev-review/`.

Evidence abbreviations used below are clickable:

| Reference | What it contains |
| --- | --- |
| [Live](evidence/live-results.json) | Named browser/API observations, response statuses/timings, browser errors, and request URLs. Find the named check in the `log` array. |
| [API](evidence/api-probe.json) | Two-user tests, invalid layouts, habits/goals, enabled/disabled suggestion responses. |
| [Extra](evidence/api-extra.json) | Corrected phone-view/starter payloads, MCP creation/initialize/revoke, live backup/restore. |
| [Scope](evidence/notification-scope.json) | Cross-user notification triage/dismissal and owner readback. |
| [Check](evidence/make-check-after-build.log) | Passing dev lint, web/mobile/Electron typechecks, and standard tests. |
| [Integration](evidence/chat-integration-utc.log) | Passing PostgreSQL chat and feature integration tests in UTC. |
| [Full PG](evidence/full-postgres-tests.log) | `CHAT_TEST_ENV=<root .env> TZ=UTC make test-api test-portability-integration`; includes focus and portability packages omitted from the chat target. |
| [UI audit](evidence/chat-ui-audit.log) | Passing `make audit-chat`, with mocked account responses and zero page errors. Receipt screenshots prefixed `mock-` are simulated, not live extraction. |
| [Inventory](evidence/test-inventory.txt) | Existing test names and source locations for mapping automated coverage. |
| [Migrations](evidence/migration-roundtrip.log) | Scratch upgrade from main, legacy goal copy, eight Down operations, eight Up operations. |
| [Desktop](evidence/desktop-health.json) | Bundled API health: database OK, version 0.2.1, migration 20261010121000, pending 0. See also desktop build and sidecar logs. |

The retained browser `COMMAND ERROR` entries include incorrect test locators, a mistaken `/tasks/:id` read route (the actual route is `/task/:id`), and connection loss during interruptions. They are not counted as app defects. Corrected checks have separate successful records. `errors`, which records browser page exceptions, remained empty. Expected rejected API requests are distinguished from unexpected failures.

## Setup and automated commands

| Check | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Exact dev/baseline revision | Pass | Commit IDs above | Preserved the current checkout; no checkout/reset/fetch needed to test this fixed revision. |
| Fresh install via `make setup` | Not checked | Existing workspace | Dependencies and root env were already configured. Reinstallation would add no coverage of these changes. |
| All eight migrations applied | Pass | [Status](evidence/migrations.log), [Desktop](evidence/desktop-health.json) | Pending count 0. |
| Clean/main-version schema upgrade and rollback | Pass | [Migrations](evidence/migration-roundtrip.log) | Scratch schema, not a downgrade of the owner's database. |
| Live suggestions Test | Pass | [Live](evidence/live-results.json), `POST /agent/decisions/test` | OpenRouter replied; one measured provider latency was 381 ms. |
| `make check` | Pass | [Check](evidence/make-check-after-build.log) | First attempt failed on generated `.next/types` referring to removed routes; build regenerated them. |
| Baseline `make check` | Pass | [Main check](evidence/main-check-verified.log) | Archived main; dependency auto-install disabled, existing workspace dependencies linked. Earlier incomplete attempts are retained but superseded. |
| `make test-chat-integration` in Tokyo | Fail | [Failing output](evidence/chat-integration.log) | Minor F1 below. |
| `TZ=UTC make test-chat-integration` | Pass | [Integration](evidence/chat-integration-utc.log) | All target packages passed. |
| Baseline integration in Tokyo | Pass | [Main integration](evidence/main-integration.log) | Main lacks the new failing series test. |
| All Go tests with PostgreSQL enabled, plus portability | Pass | [Full PG](evidence/full-postgres-tests.log) | Verifies habits/goals integration tests that the standard chat target omits. |
| `make build-desktop` | Pass | [Build](evidence/desktop-build.log) | Linux unpacked Timely Dev with sidecars and native koffi package. |
| `make audit-chat` | Pass | [UI audit](evidence/chat-ui-audit.log) | Existing browser audit with mocked API responses; no page errors. |
| `make dev-mobile` / Expo web | Fail | [Dev log](evidence/mobile-server.log), [main log](evidence/main-mobile-server.log), [screen](screens/mobile-first-load.png) | Existing blocker F2 below. |
| Reference screenshot folders in `/mnt/project-files` | Not checked | Environment | Not present/readable here; no pixel comparison against those historical images claimed. |

## Cross-cutting

| # | Check | Result | Evidence | Notes |
| --- | --- | --- | --- | --- |
| 1 | No key/off means no visible suggestions on web | Pass | [Live](evidence/live-results.json), `No-key web sweep`; [Inbox](screens/nokey-inbox.png), [Clarify](screens/nokey-clarify.png), [Dashboard](screens/nokey-dashboard.png), other `nokey-*` screens | Walked Inbox, Clarify, search, chat, tasks, doc, sheet, Today, Dashboard, Notifications and Agent settings with suggestions off. No suggestion lines or horizontal overflow in the sweep. |
| 1a | Off suggestion endpoints return promptly | Pass | [Live](evidence/live-results.json), first off endpoint records | Suggestion routes returned 200/unavailable or empty, generally 41–85 ms. Direct smart search returns ordinary search, about 882 ms; the UI does not call it when off. |
| 1b | No off-state Jev requests/logging | Partial | `TestOffMakesNoCall`, `apps/api/internal/features/decide/decide_test.go:81`; [Check](evidence/make-check-after-build.log); [Live](evidence/live-results.json) | Automated guard proves no provider call. Live UI made no smart-search request. Did not independently count database decision-log rows around every page. |
| 1c | No-key phone sweep | Not checked | F2 | Expo web never reaches app UI. |
| 2 | Bad key, fallback, slow/unavailable provider | Partial | [Live](evidence/live-results.json), invalid key records; [Integration](evidence/chat-integration-utc.log); `decide/decide_test.go` | Real invalid TypeSafe key returned 409; malformed key returned 400; OpenRouter remained usable. Fallback/rejection/cache/timeout behavior tested with stubs. No live network cut or valid TypeSafe key later revoked. |
| 3 | All migration directions | Pass | [Migrations](evidence/migration-roundtrip.log) | Upgrade from main, legacy goals, Down eight, Up eight; clean bundled database also migrated. |
| 4 | Account ownership | Partial | [API](evidence/api-probe.json), [Extra](evidence/api-extra.json), [Scope](evidence/notification-scope.json) | Foreign task/doc/project/inbox/cleanup/habit/goal/starter IDs rejected; foreign notification writes returned 404; layouts/views are account-scoped. Some safe empty/neutral endpoints intentionally return 200/204 instead of 404. Exhaustive fuzzing of every route was not performed. |
| 5 | Keys stay secret | Pass | `provider/decisions_integration_test.go:50–90`; [Full PG](evidence/full-postgres-tests.log); [Extra](evidence/api-extra.json) | Automated valid TypeSafe save verifies encrypted storage and hint-only output. Live provider status exposes hints, not secrets. Temporary MCP secrets stayed in memory and were revoked. Provider configuration was copied as encrypted SQL values, never printed. |
| 6 | Shared date/time pickers | Pass | [No native inputs](evidence/native-date-inputs.log), [workshop](screens/119-workshop-picker.png), [bulk](screens/119-bulk-picker.png) | No native `date`, `datetime-local`, or `time` inputs in web app source. |
| 7 | Light/dark, responsive sizing, reduced motion | Partial | [Desktop light](screens/113-dashboard-desktop-light.png), [dark](screens/113-dashboard-desktop-dark.png), [390 light](screens/113-dashboard-phone-light.png), [390 dark](screens/113-dashboard-phone-dark.png), [UI audit](evidence/chat-ui-audit.log) | Dashboard has no horizontal document overflow at 390; resize handles disappear. No app-wide audit of every 44 px touch target. Native phone design blocked. |
| 8 | Web/desktop/phone parity | Partial | Per-PR rows | Web and selected packaged desktop flows verified. Shared browser code does not substitute for rerunning every flow inside Electron or on a phone. |
| 9 | Bundled Linux startup and all web checks in Electron | Partial | [Desktop](evidence/desktop-health.json), [API log](evidence/desktop-api.log), [supervisor](evidence/desktop-supervisor.log), [login](screens/desktop-login.png) | Postgres/API/web startup and MCP/pointer exercised. Full web sweep was not repeated inside the package. |
| 10 | Automated suite/main comparison | Partial | Setup command table | Standard checks pass; new timezone-sensitive test fails in Tokyo. |

## #107 Drop macOS from releases

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Workflow matrix, artifacts, signing and docs | CI/docs | Brief outdated | — | `.github/workflows/release.yml:59`, `:102`, `:107`; `README.md:83`; `package.md:98`; `docs/desktop/README.md:255` | Release matrix is only Linux/Windows, with Android separately; Windows signing and missing-file errors remain. Local macOS build/signing docs and a `dmg` command description remain. The brief's claim that all Mac references were removed is too broad: tagged releases explicitly exclude macOS while local-build documentation remains. |
| Dispatch workflow on fork; actual installer/manifests | CI | Not checked | — | Workflow source | No release tag or external workflow was dispatched. Linux unpacked build is not proof of published artifacts. |

## #108 Pointer snaps to Cancel

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| X11 shared delete-confirm pointer target | Linux package | Pass | — | [Dialog](screens/108-shared-task-confirm.png), [Live](evidence/live-results.json) `108-shared-cancel`, [native position](evidence/pointer-shared-focused.log) | Cancel centre was screen (1020.82, 572.625); XQueryPointer returned (1021, 573), the rounded centre. Tested task deletion; Cancel used, task not deleted. |
| Repeat at 125%/200% zoom and display scaling | Desktop | Not checked | — | `electron/main.ts:103`, `electron/pointer.ts` | Guards transform CSS coordinates through zoom/DIPs. Test keypresses did not change page zoom, so they are not counted as zoom coverage. |
| Unfocused/minimized window | Linux | Partial | — | `electron/main.ts:96`; [Live](evidence/live-results.json) `108-unfocused-dialog` | Guard reviewed. Xvfb focus manipulation did not produce a reliably unfocused renderer; no runtime pass claimed. |
| Packaged koffi unpacked and native snap works | Linux package | Pass | — | [Build](evidence/desktop-build.log), native position above | `resources/app.asar.unpacked/node_modules/@koromix/koffi-linux-x64` present; actual native movement succeeded. |
| Browser dialog regression | Web | Pass | — | [UI audit](evidence/chat-ui-audit.log), [Live](evidence/live-results.json) | Existing audit exercises shared history-delete confirm. Browser lacks the desktop snap bridge. Doc's inline delete popover is not the shared ConfirmDialog and was not counted as a snap test. |
| Windows native pointer | Windows | Needs owner | — | `electron/pointer.ts:59` | No Windows host. |
| Wayland/no koffi graceful behavior; IPC safety guards | Desktop | Partial | — | `electron/pointer.ts:20`, `:83`; `electron/main.ts:96` | Source checks focus, main frame, same origin, finite/in-bounds values; Wayland skips warp; load failure warns. No injected native-load failure or physical Wayland session. |

## #112 Animated logo

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Boot logo, copy, light/dark and reduced motion | Desktop | Partial | — | `electron/boot.html:123`; [Desktop](evidence/desktop-health.json) | Source has 56 px animated mark, still running-step dot and reduced-motion rule. Package boots quickly; transient light/dark boot frames were not captured. |
| Forced startup failure, stopped logo, Retry | Desktop | Not checked | — | `electron/boot.html` | Did not occupy Postgres ports or inject a boot failure. |
| Four mobile spinner sites during real work | Phone | Needs owner | — | F2 | Cannot reach Expo UI; native execution pending. |

## #114 Real MCP address

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Desktop-instance/MCP URL tests | Automated | Pass | — | [Check](evidence/make-check-after-build.log), final 10 tests | Web origin, absolute API URL, release/dev/moved desktop ports and Tailscale covered. |
| Web shows working origin proxy address; initialize | Web/API | Pass | — | [Extra](evidence/api-extra.json), `MCP initialize through browser address` | Initialize through `http://localhost:4002/api-proxy/mcp` returned 200. |
| Package address and initialize | Desktop/API | Pass | — | [Settings](screens/114-desktop-mcp.png), [Live](evidence/live-results.json) `114-desktop-address`, `114-desktop-mcp-init` | Displayed `http://127.0.0.1:48090/mcp`; initialize returned 200. |
| Create/reveal once/revoke | Web/API | Pass | — | [Extra](evidence/api-extra.json) | Create 201 with `tk_` secret; list excludes full secret; revoke 200; revoked bearer 401. Desktop temporary key also revoked. |
| Copy/Copied and Hermes snippet | UI | Partial | — | `settings/apiKeysSettings.tsx:69–90`; [Settings](screens/114-desktop-mcp.png) | Address rendered and shared URL helper tested. Clipboard permission/result was not exercised. |

## #109 Sheet selection/right-click

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| A1:B3 right-click B2 preserves six-cell range | Web | Pass | — | [Inside](screens/109-inside-range.png), [Live](evidence/live-results.json) `109 right click inside selection` | Menu title and selection both A1:B3. |
| Right-click C4 outside selection | Web | Pass | — | [Outside](screens/109-outside-range.png), matching Live record | Selection/menu changed to C4. |
| Middle/non-left click does not start selection drag | Web | Partial | — | [Live](evidence/live-results.json) `109 middle click selection` | Middle-click preserved A1. Right-click case passed. Editing-state non-left click was not separately run. |
| Clear, Cut, Copy affect all six cells | Web | Pass | — | [Live](evidence/live-results.json) `109-six-cell-copy`, `109-six-cell-clear`, `109-six-cell-cut` | Copy/Cut clipboard contained three two-column rows. Clear/Cut emptied exactly A1:B3 while column C and row 4 stayed intact. Undo restored the cleared range before Cut. |
| Row/column headers and merged outside cell | Web | Not checked | — | `sheets/sheetGrid.tsx` | No runtime header/merged fixture. |
| Left click/drag, formula picking regression | Web | Partial | — | [Live](evidence/live-results.json) sheet selection/edit records; [Check](evidence/make-check-after-build.log) formula tests | Drag-select and saved cell editing exercised. Click-to-pick formula reference not manually exercised. |

## #110 Files section

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Legacy doc/sheet/index/template routes redirect | Web | Pass | — | [Live](evidence/live-results.json) `110 118 legacy redirects` | Tested signed-in old doc, sheet, sheets index and templates index. Template-ID route covered by route source; no template-ID live fixture. |
| Old saved tab rewritten on reload | Web | Pass | — | [Live](evidence/live-results.json) `110-saved-tab-rewrite` | Injected legacy doc tab; persisted history became `/files/doc_…`. |
| Doc edit, sheet edit, switch/reload persistence | Web | Pass | — | [Live](evidence/live-results.json) `110-doc-persisted`, `110-sheet-persisted` | Doc reads `QA doc persistence check`; B2 reads `QA sheet persisted`. |
| Notification, mention, agent links | Web | Partial | — | [Live](evidence/live-results.json) `115-left-click`; [doc](screens/115-open-doc.png); `utils/fileRoutes.ts` | Applied chat card opens `/files/doc_…`. Notification and mention clicks not separately live-tested. |
| Import .md and .csv | Web | Pass | — | [Live](evidence/live-results.json) `110-md-import`, `110-csv-import`, `/sheets` readbacks | Both created real items. Markdown heading/list content preserved; CSV cells and typed columns saved. |
| Files sidebar/filter/New/shortcuts | Web | Partial | — | Files screenshots; [Live](evidence/live-results.json) `110-shortcut-gf`; `utils/fileRoutes.ts` | One Files entry and All/Docs/Sheets controls render. G-F exercised; G-S and all search/status/template combinations not separately tested. |
| Phone chips/routes and instant tab continuity | Phone/web | Partial | — | `apps/mobile/app/(app)/files/`; `pageTabsStore.ts:87`; F2 | Web tab edits persist. No quantified navigation latency; mobile runtime blocked. |

## #111 Quick prompt and Activity island

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Shortcut/send/island above Sign out | Web | Pass | — | [Quick prompt](screens/111-quick-prompt.png), [live island](screens/111-chat-activity.png), [UI audit](evidence/chat-ui-audit.log) | Live chat completed; audit asserts bottom prompt geometry, context controls and sidebar placement. |
| Reduce-motion off bounce/dot; on dot-only | Web | Partial | — | [UI audit](evidence/chat-ui-audit.log); `scripts/audit-chat.cjs:566`; reduced-motion source | Audit measures bounce/spring with motion enabled. Normal review used reduced motion; dot-only behavior not instrumented to assert absence of every transform. |
| Dismiss/read; does not return without change | Web/API | Pass | — | [Live](evidence/live-results.json) `111-dismiss-read`; [UI audit](evidence/chat-ui-audit.log) | Live dismissed read-only reply disappeared; mock audit covers awaiting-review dismissal. |
| Task focus timer/Stop focus | Web | Partial | — | Activity code; [Check](evidence/make-check-after-build.log) | Pomodoro island was tested live; a task's separate focus timer/stop was not. |
| Dark, keyboard, outside/Escape behavior; auto-hide | Web | Partial | — | [UI audit](evidence/chat-ui-audit.log), mock dark/overlay screenshots | Keyboard Close/Escape focus return, outside close and dark mode pass. Auto-hide-specific handoff not run. |
| Escape closes model menu only | Web | Pass | — | [UI audit](evidence/chat-ui-audit.log); `scripts/audit-chat.cjs:531` | Model menu disappears, overlay stays. |

## #115 Close chat overlay on item navigation

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Live doc edit, applied card, normal Open doc | Web/live chat | Pass | — | [Applied overlay](screens/115-applied-overlay.png), [doc](screens/115-open-doc.png), [Live](evidence/live-results.json) `115-left-click` | `append_to_doc` completed; normal link opens file and Close-chat count becomes 0. Fixture initially had empty rich content; no preservation claim based on its plainText-only seed. |
| Ctrl-click leaves overlay | Web | Pass | — | [Live](evidence/live-results.json) `115-control-click` | Close-chat count remained 1. |
| Island mention/header item link | Web | Partial | — | `chat/chatRuntime.tsx` onClickCapture; [UI audit](evidence/chat-ui-audit.log) | Island reopens chat; normal applied-doc link tested. Mention and header links not separately clicked. |
| Esc/backdrop close; composer clicks stay | Web | Pass | — | [UI audit](evidence/chat-ui-audit.log) | Composer/model-menu interaction and both close paths tested. |
| Shift/non-left/external-link exclusions | Web | Not checked | — | `chat/chatRuntime.tsx` | Source-reviewed exclusions; no runtime assertion. |

## #119 Date picker replacement

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Countdown date editor | Web | Pass | — | [Picker](screens/119-countdown-picker.png), [Live](evidence/live-results.json) `119-countdown-set` | Added Countdown, opened shared picker, chose October 20 and saved. |
| Workshop Custom dates From/To | Web | Pass | — | [Workshop](screens/119-workshop-picker.png), [Live](evidence/live-results.json) `119-first-escape` | Custom range and From date opened shared picker. |
| Two-task bulk deadline persists | Web/API | Pass | — | [Bulk](screens/119-bulk-picker.png), [Live](evidence/live-results.json) `119-bulk-saved-readback` | Both selected tasks read back deadline `2026-10-15`; table also displayed the new date. |
| Receipt review Date | Web | Partial | — | [Mock receipt](screens/mock-timely-receipt-review.png), [UI audit](evidence/chat-ui-audit.log) | Receipt UI rendered with mocked extraction. No live receipt scan or picker interaction. |
| First Escape closes picker, next closes parent | Web | Pass | — | [Live](evidence/live-results.json) `119-two-stage-escape` | Dialog counts: 2 before Escape, 1 after first, 0 after second. |
| No native date/time fields | Source | Pass | — | [Grep](evidence/native-date-inputs.log) | All four source call sites now use shared components. |

## #113 Customizable Dashboard

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| New-account default board | Web | Pass | — | [Dashboard light](screens/113-dashboard-desktop-light.png), [Live](evidence/live-results.json) dashboard records | Nine charts and six default tools rendered before customization. |
| Drag/reorder and corner resize; reload | Web | Pass | — | [Live](evidence/live-results.json) `113-drag-reorder`, `113-resize-live`, `113-resize-persisted` | Open tasks reordered. Done-this-week changed from 3×2 to 4×3 and persisted. One earlier resize attempt did not move a card and was repeated successfully. Phone app order not verified. |
| Filtered workshop preview, add/edit card | Web | Pass | — | [Live](evidence/live-results.json) `113-workshop-reload`, `113-workshop-edit-saved`; [Clarify](screens/121-inbox-clarify.png) | Built Inbox/List card; preview matched one item; saved/reloaded; edited Name contains = Dentist and saved. |
| Pomodoro survives page change | Web | Pass | — | [Live](evidence/live-results.json) `116-island-running` | Started on Dashboard; Tasks island displayed decreasing remaining time. |
| <560 px single column/no resizing | Responsive web | Pass | — | [390 light](screens/113-dashboard-phone-light.png), [Live](evidence/live-results.json) `113-phone-width` | Width/scroll both 390; zero Resize separators. |
| Duplicate IDs/61 cards refused, board unchanged | API | Pass | — | [API](evidence/api-probe.json) | Both 400; subsequent layout unchanged. Other structural/size limits tested by existing validator tests, not every live payload. |
| `make test-dashboard` | Automated | Pass | — | [Check](evidence/make-check-after-build.log) | Included in `make check`. |
| Scratchpad persistence/no page errors | Web | Pass | — | [Live](evidence/live-results.json) `113-resize-persisted` | Scratchpad text survived navigation/reload; page exception array empty. |
| Rename/card sizes/duplicate/remove/undo/reset/empty board | Web | Partial | — | Card menu/workshop snapshots; [Check](evidence/make-check-after-build.log) | Controls render and layout engine tests pass. All menu actions not individually exercised. |
| Phone Settings Dashboard editor | Phone | Needs owner | — | F2 | Mobile UI blocked. |

## #116 Pomodoro Activity island

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Running timer on another page | Web | Pass | — | [Island](screens/116-activity-pomodoro.png), [Live](evidence/live-results.json) `116-island-running` | Focus · 24:58 left on Tasks. |
| Pause/Resume/Stop and disappearance | Web | Pass | — | [Live](evidence/live-results.json) `116-island-paused`, `116-island-stopped` | Paused detail rendered; Resume ran; Stop reset and island button count became 0 before live chats were added. |
| Row opens Dashboard | Web | Not checked | — | Activity island source | Navigated to Dashboard directly, not by clicking this row. |
| Linked focused task gives one row/Stop ends focus | Web | Not checked | — | Activity island source | No linked-focus fixture. |
| Reload away mid-phase, automatic completion/chime | Web | Not checked | — | Pomodoro store and shared tests | Did not wait a complete phase or assert audio/background completion. |

## #117 Pomodoro ring and minute controls

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle + twice/− twice | Web | Pass | — | [27 minutes](screens/117-idle-27.png), [Live](evidence/live-results.json) `117 idle two plus` | 25→27→25. |
| Hold + repeats | Web | Not checked | — | `report/pomodoroCard.tsx` | Separate hold gesture not run. |
| Running + and paused − twice | Web | Pass | — | [Live](evidence/live-results.json) `117-running-paused-deltas` | Started at 25, added one, paused, removed two; 24:00 remained. Phase did not end. |
| Reset/reload returns configured 25 minutes | Web | Pass | — | [Live](evidence/live-results.json) `117-reset-round` | Readback 25:00 after reload. |
| Ring stable after settings open/close | Web | Pass | — | [Live](evidence/live-results.json) `117-ring-settings-stable` | SVG ring dimensions 200×200 before/after; surrounding icon dimensions also unchanged. |
| Dark ring track/swatches | Web | Partial | — | [Dark Dashboard](screens/113-dashboard-desktop-dark.png), workshop source | Track visibly distinct. Swatch controls rendered; all colours not individually inspected. |
| Bounds, next phase reset, phone notification reschedule | Shared/phone | Partial | — | [Check](evidence/make-check-after-build.log), pomodoro tests; F2 | Shared timing tests pass; next-round leak not live-tested; notification reschedule needs real phone. |

## #118 Dashboard rename and smoother drag

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| /report redirect, Dashboard first, old Report gone | Web | Pass | — | [Live](evidence/live-results.json) legacy redirects; Dashboard screens | Actual /report→/dashboard and first sidebar icon observed. Nested route is source-covered. |
| G-D/G-R Dashboard; G-F Files | Web | Pass | — | [Live](evidence/live-results.json) `118-shortcut-gd`, `118-shortcut-gr`, `110-shortcut-gf` | URLs recorded after shortcuts. |
| Smooth drag under reduced motion | Web | Partial | — | [Live](evidence/live-results.json) `113-drag-reorder`; `report/dashboardGrid.tsx` | Live drag worked. No frame-time benchmark or claim that every frame is <50 ms. |
| Mermaid and transitionend regression | Web | Not checked | — | Reduced-motion implementation | Did not create/render a diagram or exercise all transitionend-dependent flows. |
| Phone renamed Settings row/route | Phone | Not checked | — | F2 | Source present; runtime blocked. |

## #121 Dashboard Inbox opens Clarify

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Custom Inbox/List row opens populated Clarify | Web | Pass | — | [Clarify](screens/121-inbox-clarify.png), [Live](evidence/live-results.json) `121-dashboard-inbox` | Dentist item opens Clarify, not regular task panel. |
| Ordinary Overdue row opens task editor | Web | Partial | — | Dashboard task callback source; ordinary task-panel live checks | Fixture was due tomorrow, not overdue. Ordinary task editor works, but Overdue-card trigger not separately tested. |

## #120 Settings, Clarify, work estimates

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Save key/source/Test | Web/API | Partial | — | [Live](evidence/live-results.json) live Test; [Full PG](evidence/full-postgres-tests.log), provider decision tests | Real OpenRouter source/Test passed. Valid TypeSafe save verified with a stub; no real TypeSafe key. |
| Invalid TypeSafe key, OpenRouter still works | API/live | Pass | — | [Live](evidence/live-results.json), key 409/400 and later successful hints | Bad key rejected before replacement; fallback remained available. |
| Renew passport by Friday prefills/deadline | Web/live | Pass | — | [Clarify](screens/120-clarify-with-key.png), [Live](evidence/live-results.json) `Clarify with key` | High priority and deadline 2026-10-16; explanatory deadline hint rendered. |
| Priority touched before response is preserved | Web | Partial | — | `addItem.tsx` untouched-field guards | Source reviewed; no delayed live Priority override assertion. |
| Near-duplicate chip opens task | Web | Not checked | — | Suggestion integration tests | No exact live duplicate fixture; known low-confidence misses are not treated as failure. |
| Switch off/no UI/no new log rows | Web/automated | Partial | — | Off sweep; `TestOffMakesNoCall`; [Check](evidence/make-check-after-build.log) | Off UI passed; no live row-count measurement. |
| Agent create send-invoice gets bucketed length | Live/API | Partial | — | [Live](evidence/live-results.json) `/suggestions/estimate` returned 15; existing agent tests | Estimation endpoint exercised, not an agent-created invoice task readback. |
| Genuine no-key settings and 30-minute agent fallback | Web/API | Partial | — | Isolated packaged account has no provider key; [Full PG](evidence/full-postgres-tests.log) | Main sweep used toggle off. No-key guard/fallback covered by tests; no live no-key create-task conversation. |
| No-key Clarify loading flash | Web | Brief outdated | — | [Live](evidence/live-results.json) `No-key Clarify delayed response`; `addItem.tsx:795` | Delayed response/DOM observation showed no “Getting suggestions…” flash. Current caller is gated by decisions availability; brief's “always calls” warning is outdated. |
| Phone Inbox suggestions/Apply/Dismiss | Phone | Needs owner | — | F2 | Cannot reach mobile UI. |

## #122 Agent chat suggestions

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Read-only what's-due question has no proposal | Web/live | Pass | — | [Live](evidence/live-results.json), chat `chat_88144951-…` | Answer completed idle, empty plan, no writes. |
| Earlier-chat pointer and Answer here | Live/API | Pass | — | [Live](evidence/live-results.json), Claude/Codex chat `similar` messages and `/similar` stay responses | Both waited in choose, then Answer here completed. No chat left stuck. |
| Continue there moves message/deletes new chat | Automated/live | Partial | — | `chat/jev_test.go:168`, [Integration](evidence/chat-integration-utc.log) | Existing integration covers branch; no live move performed. Phone buttons unverified. |
| Unrequested/missing change forces review | Automated | Pass | — | `chat/jev_test.go:250`, [Integration](evidence/chat-integration-utc.log) | Stubbed typed answers verify review note and forced approval. External-model accuracy not measured. |
| Sensitive chats skip Jev/notes | Automated | Pass | — | `chat/jev_test.go:296`, [Integration](evidence/chat-integration-utc.log) | Assertions confirm no sensitive chat content sent. |
| Non-Latin language without Jev | Automated | Partial | — | `chat/robustness_test.go:350`, [Check](evidence/make-check-after-build.log) | Language detection/translation tested; no live non-Latin conversation. |
| No-key tools/no choose/no notes; no repeat triage | Automated | Partial | — | `chat/jev_test.go:137`, `:313`; [Integration](evidence/chat-integration-utc.log) | Off/unsure guard and batched review covered; no full no-key live tool transcript. |

## #123 Smart search and Related

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Weak-match line, Show/Hide | Web/live | Pass | — | [Settled search](screens/123-search-create-settled.png), [Live](evidence/live-results.json) `123-search-settled`, `123-show-weak` | Query produced two hidden weak matches; Show moved them to end; Hide restored hiding. Query used budget, not milk. |
| Make budget sheet→Suggested→prefilled Budget | Web/live | Pass | — | [Live](evidence/live-results.json) `123-budget-title-confirmed` | New Sheet modal title input value Budget. |
| Budget spreadsheet kind chip/no create | API/live | Partial | — | [API](evidence/api-probe.json), smart search queries | API behavior inspected; second query UI click not separately run. |
| One-letter query plain only | Web | Not checked | — | Smart search guard source | No runtime one-letter assertion. |
| Related task/doc/project, none for Inbox | Web/API | Partial | — | Off related response; search tests; [Integration](evidence/chat-integration-utc.log) | No live embedding-backed Related UI sweep with these QA items. |
| Deleted item omitted | Automated | Pass | — | Search integration tests, [Integration](evidence/chat-integration-utc.log) | Search package tests passed; no live delete/search latency measurement. |
| Agent none-looks-like-match message | Automated/live | Partial | — | Agent search/rerank tests, [Full PG](evidence/full-postgres-tests.log) | No live absent-topic agent prompt. |
| Slow-result highlighted row stability | Web | Not checked | — | Palette implementation | Did not inject delayed reranking while keyboard-selected. |
| Off means no smart/related requests or decorations | Web | Pass | — | [Live](evidence/live-results.json) no-key palette/query; [screen](screens/nokey-search.png) | Ordinary semantic search remained functional. |
| Phone search/Related | Phone | Not checked | — | F2 | Expo UI blocked. |

## #124 Receipts, templates and CSV types

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Receipt category/hints/destination with no attachment | Live receipt/UI | Partial | — | [UI audit](evidence/chat-ui-audit.log), [mock receipt](screens/mock-timely-receipt-review.png) | Destination/review interaction passed with simulated extraction; no real receipt-model accuracy test. |
| Same purchase duplicate hint | Automated | Pass | — | `chat/receipts_test.go:106`, [Integration](evidence/chat-integration-utc.log) | Live photo duplicate not tested. |
| Thanks leaves draft unchanged | Automated/live | Partial | — | Receipt suggestion tests, [Full PG](evidence/full-postgres-tests.log) | No live receipt conversation. |
| Shop reused as Merchant column | Automated/live | Partial | — | Sheet/receipt matching tests, [Integration](evidence/chat-integration-utc.log) | No live receipt with Shop fixture. |
| Trip template auto-pick/manual override | Web | Partial | — | Template tests/source, [Check](evidence/make-check-after-build.log) | No saved Trip template UI auto-pick fixture. |
| CSV Date/Amount/Status/Paid/ZIP types and values | Web/live | Pass | — | [Live](evidence/live-results.json) `124-csv-sufficient-samples` | Four rows: date/currency/select/boolean/text; ZIP leading zeros kept. Two/three rows with two Status choices stayed text correctly: `suggest/sheets.go:232` requires at least twice the distinct choices. |
| Unexpected sheet edit gets review note | Automated | Partial | — | Sheet review tests, [Full PG](evidence/full-postgres-tests.log) | No deliberately destructive live sheet proposal. |
| >60 columns rejected | API | Pass | — | [Live](evidence/live-results.json), column-types 400 | Error: Send at most 60 columns. |
| Off hints/templates/types/destination baseline | Web/API | Partial | — | No-key sheet screen; off column/template responses; [UI audit](evidence/chat-ui-audit.log) | API unavailable, no hints. Off CSV import and live thanks baseline not repeated. |
| Phone receipt/CSV/template parity | Phone | Needs owner | — | F2 | Blocked. |

## #125 Task/project hints, stale work and cleanup

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Description blocked-by hints; apply status/blocker | Web/API | Partial | — | [API](evidence/api-probe.json) live task hints; [task hints](screens/125-task-hints.png); `suggest/integration_test.go:169` | Live deep-work hints rendered. Mapping status/blocker verified with stub; both live apply actions not run. |
| Completed task with unchecked checklist note | Automated | Pass | — | `suggest/integration_test.go:169`, [Integration](evidence/chat-integration-utc.log) | Automated semantic hint mapping; UI note not separately seeded. |
| Stale >21 days; Keep/Done/Undo | Automated/live | Partial | — | `suggest/integration_test.go:229`, [Integration](evidence/chat-integration-utc.log) | Exclusions/recent-activity selection tested; no aged live fixture/undo click. |
| Project brief, misfiled/overlapping work, Add/Move/Undo | API/automated | Partial | — | [API](evidence/api-probe.json) project hints; `suggest/integration_test.go:261` | Project hint endpoint works; exact live move/undo/add UI not exercised. |
| Urgent/Urgent! swap/merge and saved-view rewrite | Automated | Pass | — | `workspace/merge_integration_test.go:11`, `suggest/integration_test.go:318`; [Integration](evidence/chat-integration-utc.log) | Label/status/options merge and phone/web view references tested transactionally; no live irreversible merge. |
| New project Copy/stages/tasks/templates/form fields | Automated/live | Partial | — | `suggest/integration_test.go:345`, task duplication tests; [Integration](evidence/chat-integration-utc.log) | Backend paths covered; no end-to-end New Project checkbox flow. |
| Live chat label-everything calls pick_tasks | Live chat | Not checked | — | Agent tool implementation/tests | No bulk live labeling request. |
| Dependency cycles/completed status/self merge/cross workspace/bulk partial failure | Automated | Partial | — | Workspace/task/agent tests, [Full PG](evidence/full-postgres-tests.log) | Existing tests cover ownership/merge/duplication. Not an exhaustive live >50-task failure exercise. |
| Off hides hints/stale/insights/cleanup/Start from | Web/API | Pass | — | Off endpoint records and task/Files/Today sweep in [Live](evidence/live-results.json) | No visible suggestion lines. All individual creation dialogs not repeated. |
| Phone parity | Phone | Needs owner | — | F2 | Blocked. |

## #126 Doc suggestions/imports

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Project suggestion Add/Undo | API/automated | Partial | — | [Live](evidence/live-results.json) main QA doc project/plan suggestion; `suggest/integration_test.go:391` | Real project pick received. Live Add/Undo not clicked. |
| Named empty doc template/typed replacement confirm | Automated | Pass | — | `suggest/integration_test.go:465`, doc-template tests; [Integration](evidence/chat-integration-utc.log) | Automated typed suggestions; live replacement UI not exercised. |
| To-do line Create task with workspace/project | Automated | Pass | — | `suggest/integration_test.go:391`; [Integration](evidence/chat-integration-utc.log) | Not a live model/UI accuracy pass. |
| Move to page excludes own descendants/invalid targets | Automated/live | Partial | — | Doc move/link tests; [Full PG](evidence/full-postgres-tests.log) | No live nested-page picker fixture. |
| Link selection creates mention/cross-line errors | Automated/live | Partial | — | `suggest/integration_test.go:494`; mobile doc helper tests; [Check](evidence/make-check-after-build.log) | Real endpoint guard/selection helpers covered; no web editor mention insertion gesture. |
| Plain text formatting; Markdown unchanged | API/web | Pass | — | [Live](evidence/live-results.json), import-format returned heading/heading/bullet/bullet/quote; `110-md-import` | Plain formatting API and real Markdown importer both verified. End-to-end plain-text file formatting/timeout fallback not repeated. |
| Dropped requested section review note | Automated | Partial | — | Chat/agent document review tests, [Full PG](evidence/full-postgres-tests.log) | No live intentionally incomplete draft. |
| Off card/link/import review baseline | Web/API | Partial | — | [No-key doc](screens/nokey-files-doc_b54912b3-5a72-4647-b12e-0de64641818b.png), off mention/import-format responses | Off API returns empty mention options and paragraph kinds; Move-to-page without key not manually run. |
| Phone doc hints/parity | Phone | Needs owner | — | F2 | Native doc WebView additionally requires real device. |

## #127 Today, scheduling and calendar

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Mornings/Today picks/goals/Add focus/Schedule gap | Web/API | Partial | — | [Live](evidence/live-results.json) Today suggestions; [API](evidence/api-probe.json); `suggest/today_integration_test.go:53` | Live picks and goal association appeared. At late Saturday time no eligible working-hours gap; gap placement covered with stubbed tests, not live Schedule here. |
| 120-minute task one-sitting/deep morning hints | Web/live | Pass | — | [Task hints](screens/125-task-hints.png), [Live](evidence/live-results.json) task hints | Deep effort and clipped 09:00–12:00 morning window returned/rendered. Applying both constraints not tested. |
| Two Auto-schedule previews/ranks/time/manual preservation | Automated/live | Partial | — | `placement/integration_test.go:418`, `:529`; [Integration](evidence/chat-integration-utc.log) | Apply/Undo/manual protection tested; no live twice-preview latency benchmark. |
| Overdue/missed suggested step; deadline/read state | Automated | Pass | — | `notify/triage_integration_test.go:23`, `suggest/today_integration_test.go:193`; [Integration](evidence/chat-integration-utc.log) | Backend actions and safe retries covered; UI step not manually clicked. |
| Full calendar Add time leaves estimate unchanged | Automated/live | Partial | — | Notification/placement tests, [Integration](evidence/chat-integration-utc.log) | No full live calendar fixture. |
| Off no Today/deep time/triage hints | Web/API | Pass | — | [Today off](screens/nokey-today.png), [notifications off](screens/nokey-notifications.png), off API records | Ranking with empty traits covered by scheduler tests. |
| Meeting intent, protected blocks, own-task replan | Automated | Pass | — | `chat/jev_test.go:360`; `placement/integration_test.go:235`, `:529`; [Check](evidence/make-check-after-build.log), [Integration](evidence/chat-integration-utc.log) | Algorithmic coverage, not external model/physical notification coverage. |
| Phone Today/notification parity | Phone | Needs owner | — | F2 | Blocked. |

## #129 Alerts, briefing and Highlights

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Due/unplanned, unblocked, Inbox aged candidate alerts | Automated | Pass | — | `suggest/alerts_integration_test.go:14`; [Integration](evidence/chat-integration-utc.log) | Candidate groups/actions verified with seeded fixtures and typed stubs. No live daily job forced. |
| Review/Clarify/Add Focus/Find time actions | Automated/UI | Partial | — | Notify/suggestion tests; [Integration](evidence/chat-integration-utc.log) | No complete live notification action sequence. |
| Repeat job max three/dedupe/one task per day | Automated | Pass | — | `notify/alert_dismiss_integration_test.go:32`; alert/job tests; [Integration](evidence/chat-integration-utc.log) | Daily delivery and dedupe covered transactionally. Push service not contacted. |
| Morning briefing Top today | Automated | Pass | — | `suggest/alerts_integration_test.go:81`; notify digest tests; [Integration](evidence/chat-integration-utc.log) | Stubbed ranking, not live scheduled morning delivery. |
| Highlights facts/blocked/missed themes/tips | Automated/API | Partial | — | `suggest/alerts_integration_test.go:93`; [Integration](evidence/chat-integration-utc.log); off Highlights response | Theme/rank tests pass. No populated live Dashboard Highlights card. |
| Smart-alert toggle off next day/push Inbox route | Phone/job | Needs owner | — | Notify setting/source/tests | No real device push or multi-day live clock test. |
| No key: alerts/Highlights/triage hidden, inline briefing | Web/automated | Partial | — | No-key Dashboard/Notifications; `TestOffMakesNoCall`; notify tests | No visible suggestion lines. Catalogue and full live digest text not separately asserted. |
| Clear all preserves smart dismissal history | Automated | Pass | — | `notify/alert_dismiss_integration_test.go:32`; [Integration](evidence/chat-integration-utc.log) | Smart rows kept/dismissed, normal reminders deleted, feedback counted once. Earlier brief's known gap is closed in code/tests. |

## #130 Onboarding and personalization

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Fresh Work+Business, untick label, create labels | Web/API | Pass | — | [Onboarding](screens/131-onboarding-extras.png), isolated workspace readbacks | Work created with nine selected labels, Quick win omitted; Business extra workspace created. Onboarding presets require no key. |
| No-deadline tip, dismiss/reload | Automated/live | Partial | — | `suggest/personal_test.go:176`; [Integration](evidence/chat-integration-utc.log) | Persisted dismiss/learned rule tested; no 10+ task live tip fixture. |
| Project-aware empty chat four ideas | API/automated | Partial | — | [Live](evidence/live-results.json) project prompts; `suggest/personal_test.go:278` | Four real project prompts returned. Project-specific empty chat UI not separately opened. |
| Saved view smart search/Open view | Automated/live | Partial | — | Search view integration tests; [Integration](evidence/chat-integration-utc.log) | No live what-needs-attention palette → view navigation. |
| Prefs update independent columns/learned confidence thresholds/reset | Automated | Pass | — | `suggest/personal_test.go:176`; decide learned tests; [Full PG](evidence/full-postgres-tests.log) | Covers threshold behavior without waiting 30 real days. |
| Foreign workspace/project IDs | API | Brief outdated | — | [API](evidence/api-probe.json), [Extra](evidence/api-extra.json) | Writes/cleanup/inbox etc reject foreign IDs. Project-template and prompt suggestions return 200 with no foreign content; feedback is neutral 204. The “all must be 404/403” wording overstates the contract. No disclosure observed. |
| No-key presets work, personalization/tips/prompts hidden | Web/API | Partial | — | Live onboarding; off prompts/tips/starter records | Presets and off endpoints passed. Not every settings subpanel separately inspected. |
| Phone onboarding/tips/prompts/view search | Phone | Not checked | — | F2 | Runtime blocked. |

## #131 Review fixes, phone parity, habits/goals

### Clarify dates and suggested duration

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Dentist tomorrow at 3pm as reminder | API/automated | Partial | — | [API](evidence/api-probe.json), Inbox suggestions; `suggest/dateparse_test.go:8`; [Full PG](evidence/full-postgres-tests.log) | Date parser proves next day 15:00; live API received title/date role. Saving web Reminder field not separately completed. |
| Tonight/evening 19:00, afternoon 15:00 | Automated | Pass | — | `suggest/dateparse_test.go:44`, [Check](evidence/make-check-after-build.log) | Explicit parser cases. |
| Past-today time→next hour; no-time reminder 09:00 | Web/phone | Partial | — | Reminder fill source; picker helper tests | No live clock-shifted save/readback. |
| 2 amigos / 2 may false matches; invalid 31 June | Automated | Pass | — | `suggest/dateparse_test.go:8`, `:44`, [Check](evidence/make-check-after-build.log) | Explicit false-match cases. |
| Friday-next-week / next-Friday-following-week | Automated | Partial | — | `suggest/dateparse_test.go:8`; date parser | Same-weekday and next-week semantics covered; exact Friday-on-Friday and Monday-next-Friday fixtures not independently added. |
| Report due 3 Nov is Deadline only | Automated/live | Partial | — | Parser case Nov 3; live passport deadline-only Clarify | Exact report-title UI not run. |
| Touched deadline untouched; start is date-only | Web | Partial | — | `addItem.tsx` date-role/untouched guards | Source reviewed; no delayed live field override assertion. |
| No key fills nothing | Web | Pass | — | [No-key Clarify](screens/nokey-clarify.png), [Live](evidence/live-results.json) delayed response observation | No prefill/flash. |
| Estimate available/minutes and short-title/off behavior | API/live | Pass | — | [Live](evidence/live-results.json) estimates 15 and short title with no minutes; off estimate unavailable | Under-three-character title returns available:true without minutes when provider exists; no offered estimate. |
| Web New Work 800 ms offered-only chip; hidden in reminders/Clarify/equal | Web | Partial | — | New-work estimation source; API result | No live debounce/untouched-duration assertion. |
| Phone suggested duration row | Phone | Needs owner | — | F2 | Blocked. |

### Onboarding extras and mobile parity

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Suggested names, unticked extra exclusion, checked extra creation | Web | Pass | — | [Onboarding extras](screens/131-onboarding-extras.png), workspace/label readbacks | Work prefilled; Business checked and created; one label unticked and omitted. Extra-workspace failure fallback not injected. |
| Desktop /setup has no application shell | Desktop | Partial | — | Setup/onboarding source; [desktop login](screens/desktop-login.png) | Login/onboarding shell behavior observed; exact /setup first-run UI not traversed. |
| Assistant hint/pinch absent on auth and onboarding | Phone | Not checked | — | F2; mobile app-shell source | Expo cannot render. |
| Phone Agent Test and deep-work preference | Phone | Needs owner | — | F2 | Blocked. |
| Phone task one-sitting/morning hints | Phone | Needs owner | — | F2 | Blocked. |
| Phone workspace merge/swap and safe kept side | Phone/automated | Partial | — | Workspace merge tests; `suggest/suggest_test.go:78`; [Full PG](evidence/full-postgres-tests.log) | Kept completion/default logic tested. Phone controls not run. |
| Phone Create Project title/Start from | Phone | Needs owner | — | F2 | Blocked. |
| Phone project chat prompts/plain import | Phone/automated | Partial | — | Mobile import helpers and prompt integration; [Check](evidence/make-check-after-build.log) | Helpers pass; runtime blocked. |
| Phone doc type/property/template actions | Phone/automated | Partial | — | `make test-mobile-doc-jev`, `make test-mobile-file-templates` in [Check](evidence/make-check-after-build.log) | Helper assertions passed; actual UI blocked. |
| Phone Link selection WebView + stale/cross-line errors | Phone | Needs owner | — | Mobile helper tests; F2 | Native WebView selection cannot be verified with Expo web even after startup is fixed. |
| Phone new doc/sheet template sheet and Suggested/Yours | Phone | Needs owner | — | F2 | Template helper tests pass; UI blocked. |

### Habits and goals

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Legacy settings goals migrate in order/down/up | PostgreSQL | Pass | — | [Migrations](evidence/migration-roundtrip.log), focus migration integration in [Full PG](evidence/full-postgres-tests.log) | Learn Go, Finish project, Run a marathon migrated, blank omitted/whitespace trimmed. Down and re-Up succeeded. |
| Habit web toggle and reload; yesterday streak survives unchecked today | Web/API | Pass | — | [Live](evidence/live-results.json) `131-habit-web-toggle`; [API](evidence/api-probe.json) | Done today true/streak2→unchecked today/streak1 after reload; rechecked afterwards. |
| Phone refresh sees web check | Phone/API | Partial | — | Shared API check readback; F2 | Server state correct; no phone renderer. |
| Sixth goal/name limits/habit cap/streak dates | API/automated | Pass | — | [API](evidence/api-probe.json), focus integration tests in [Full PG](evidence/full-postgres-tests.log) | Sixth/blank goal and 81-character habit rejected; max20 habits/streak validation tested automatically. |
| Reorder and rename/delete ownership | API/automated | Pass | — | [API](evidence/api-probe.json), focus route tests | Goal reverse order persisted; foreign habit check/update/delete and goal writes rejected 404. |
| Today editor/goal cap copy/item expansion | Web | Partial | — | [Live](evidence/live-results.json) `131-edit-goal-cap`; [screen](screens/131-habits-goals.png) | “Goals (up to 5)” and max-five message rendered; item counts appeared once suggestions refreshed. No live drag rename/delete confirm or expanded task click. |
| Off lists remain editable, progress unavailable/items hidden | API/web | Partial | — | [API](evidence/api-probe.json) off habits/goals/progress | Lists stay available while goal progress unavailable. Full off UI edit sequence not repeated. |
| Chat check off Stretch | Live chat | Not checked | — | Focus agent tool tests, [Full PG](evidence/full-postgres-tests.log) | No live habit-tool request. |
| Account backup/restore preserves habits/goals/checks/order | Live/API | Pass | — | [Extra](evidence/api-extra.json) | Deleted isolated habit and one goal, restored export; two-day streak and all five ordered goals returned. Owner account was not restored/replaced. |
| Phone Home edit sheet/reorder arrows | Phone | Needs owner | — | F2 | Blocked. |
| Settings moved goals to Today | Web/source | Partial | — | Agent settings source; Today screenshot | Today owns goals; exact settings explanation not separately captured. |

### Server phone views and agent targeting

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Phone config views persist, empty list ignored, web untouched | API | Pass | — | [Extra](evidence/api-extra.json) | Corrected structurally valid payload saved; empty list preserved it; web view array unchanged; second user independent. Initial invalid probe was rejected correctly. |
| Phone-client live chat creates overdue-by-priority view | Live/API | Pass | — | [Live](evidence/live-results.json) `131-phone-chat-final` | Reviewed create_task_view ran with client:phone, created QA phone attention in mobileTaskViews and selected it. Four web views remained unchanged. |
| Phone Open view/search route; web-client converse isolation | Phone/automated | Partial | — | Agent view integration tests, [Full PG](evidence/full-postgres-tests.log); F2 | Backend phone path tested live; web/phone tool scoping tested automatically; no actual phone Open-view navigation. |
| Three-way pending local merge/20-view cap | Automated | Pass | — | `make test-mobile-task-views` in [Check](evidence/make-check-after-build.log) | Existing rebase/first-sync/cap tests passed. |
| MCP remains web scoped; delete view MCP-only | Automated | Partial | — | Agent view/tool catalog tests, [Full PG](evidence/full-postgres-tests.log) | No live MCP delete-view operation. |
| Ambiguous dentist resolve_target asks; specific Sam moves | Automated/live | Partial | — | Agent resolve-target tests, [Full PG](evidence/full-postgres-tests.log) | No live two-event mutation fixture. |
| Attachment preview keeps every chip/unsaved draft full | Automated | Pass | — | Chat attachment preview tests; [Full PG](evidence/full-postgres-tests.log) | Stubbed confidence/privacy paths verified. |
| Long-doc focus trim/placeholder restoration/reformatted refusal | Automated | Pass | — | `agent/docpassages_test.go:96`, `:241`, `:278`; chat robustness tests; [Full PG](evidence/full-postgres-tests.log) | Tests preserve kept-out sections, refuse changed placeholders and stale concurrent writes. Small live append is not long-doc coverage. |

### Cell-fit, notifications, repeating work and safety fixes

| Check | Platform | Result | Severity | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Category Tuesday flagged; Pharmacy/Utilities not flagged | API/live | Pass | — | [Live](evidence/live-results.json), three cell-fit responses | Tuesday misfit true (~439 ms); Pharmacy false; existing Utilities false without another decision (~11 ms). |
| Amber cell address/Go to cell/Dismiss/change feedback | Web/phone | Partial | — | Cell-fit handler/helper tests; [Check](evidence/make-check-after-build.log) | Endpoint verified; live banner UI/feedback sequence not exercised. Native phone new-row path needs owner. |
| DELETE notification ownership | API | Pass | — | [Scope](evidence/notification-scope.json) | Foreign triage/delete 404; owner still sees fixture, owner delete succeeds. |
| Smart Dismiss/Clear all hide rows, record once, no push | Automated | Pass | — | `notify/alert_dismiss_integration_test.go:32`, `:245`; [Integration](evidence/chat-integration-utc.log) | Includes preserved history and dismissed-alert push guard. |
| Three distinct days mute, action restores; one-day Clear counts once | Automated | Pass | — | `notify/alert_dismiss_test.go:12`; [Check](evidence/make-check-after-build.log); dismissal integration | Tests rolling window, acted-kind exception, distinct local dates and multiple alerts on same day. No live multi-day provider job experiment. |
| Start from weekly Wednesday→Monday/six occurrences | Automated | Partial | Minor | `task/series_restart_test.go:13`, `:49`; [Integration](evidence/chat-integration-utc.log), [Tokyo failure](evidence/chat-integration.log) | Scheduling/count behavior passes UTC; Tokyo integration assertion is F1. No New Project UI copy performed. |
| Monthly/yearly UNTIL preserves occurrence count | Automated | Pass | — | `task/series_restart_test.go:49`; [Check](evidence/make-check-after-build.log) | Includes variable month lengths and leap-day rules. |
| Repeating missed task only Lower priority | Automated | Pass | — | `notify/triage_test.go:11`; [Check](evidence/make-check-after-build.log) | Other actions refused. |
| Overdue locked time refused/old deadline chip never moves earlier | Automated | Pass | — | Notification triage integration tests; [Integration](evidence/chat-integration-utc.log) | No live obsolete-chip interaction. |
| Replace keeps past/locked blocks; Undo restores | Automated | Pass | — | `placement/integration_test.go:529`; [Integration](evidence/chat-integration-utc.log) | Backend transactional assertions. |
| Today gap excludes work planned ahead | Automated | Pass | — | `suggest/today_test.go`; `today_integration_test.go`; [Check](evidence/make-check-after-build.log), [Integration](evidence/chat-integration-utc.log) | No live free-gap fixture at late Saturday time. |
| Related excludes Inbox/own project work; docs Add link | Automated/UI | Partial | — | Search tests/source; [Integration](evidence/chat-integration-utc.log) | No live Add-link UI or large-label (>30) shortlist fixture. |
| Sensitive chat never reranks content | Automated | Pass | — | `chat/jev_test.go:296`; sensitive guards/tests, [Full PG](evidence/full-postgres-tests.log) | Automated no-call assertions. |
| Off Highlights/Start from/triage hidden; day counts DST-safe | Automated/web | Partial | — | Off sweep; `suggest/alerts_test.go:68`; [Check](evidence/make-check-after-build.log) | Calendar-day tests pass; not every off catalogue/dialog separately visited. |

## Failures in detail

### F1 — #131 repeating-series integration test depends on process timezone

Severity: **Minor** (test portability; no demonstrated production schedule error). New on dev; main's integration suite passes in Tokyo.

Steps:

1. Use the configured root `.env`/Postgres in this checkout and Asia/Tokyo process timezone.
2. Run `make test-chat-integration`.
3. Run the same target with `TZ=UTC`.

Expected from the brief: “make check and make test-chat-integration pass.” For the series, the first matching Monday should preserve the original time of day.

Actual: `TestIntegrationCopyProjectTasksFreshRestartsSeries` fails at `apps/api/internal/features/task/series_restart_integration_test.go:58`: `2026-10-12 18:00:00 +0900 JST` is compared by `Hour()` with 9. That instant is **09:00 UTC**, so the returned instant is correct for the test's UTC fixture. The test compares local clock fields without normalizing the returned time. All integration packages pass under UTC.

Evidence: [Tokyo failure](evidence/chat-integration.log), [UTC pass](evidence/chat-integration-utc.log), [main pass](evidence/main-integration.log); source assertion at `series_restart_integration_test.go:55–58`.

Likely cause: the database driver returns the undated project's timestamp in the connection/process timezone, while this assertion expects UTC clock fields. The dated-series assertion already compares instants with `Equal`, so it is unaffected.

Suggested fix: normalize the returned timestamp to the fixture's timezone before checking weekday/hour, or compare the expected instant using `Equal`. Add CI coverage with a non-UTC timezone. No fix applied.

### F2 — Existing Expo web startup crash blocks phone browser review

Severity: **Blocker for Expo web**, reproduced on both dev and main. This is a pre-existing compatibility problem, not a confirmed regression in #107–#131.

Steps:

1. Run `make dev-mobile MOBILE_METRO_FLAGS=--web`.
2. Open Expo at `http://localhost:8082/` at phone width.
3. Repeat against archived main on port 8083 using the same installed dependencies.

Expected from the brief: “open the Expo web build at a phone size (390×844)” and inspect the app's screens.

Actual: the initial route throws **`this.validatePath is not a function`** before sign-in or app UI. Both revisions reproduce the same error. The stack passes through expo-file-system `Directory`, `Paths.document`, and eager native-file storage initialization. The first main attempt also lacked a linked `marked` dependency; after that harness dependency link was corrected, main reached the same validatePath error.

Evidence: [dev Expo log](evidence/mobile-server.log), [baseline Expo log](evidence/main-mobile-server.log), [error screen](screens/mobile-first-load.png), [Live](evidence/live-results.json) `Mobile error details`.

Likely cause: `apps/mobile/lib/offlineQueue.ts:18` constructs `new File(Paths.document, …)` at module load; `apps/mobile/lib/pomodoroStore.ts:63` uses the same pattern. Expo web/SSR evaluates native filesystem paths whose implementation does not provide the native validatePath method. Error handling inside the later read function cannot catch module-initialization failure.

Suggested fix: initialize native storage lazily behind a platform check and provide web-compatible persistence for Expo web/SSR. Retest both initial auth routes and the mobile app afterward, then perform real-device parity checks. No fix applied.

## Brief mismatches and test limitations

- The brief alternates between main ports and review ports. The user-provided AGENTS instruction wins: review servers used 8081/4002, not 8080/4001.
- #107 drops **release artifacts**, but local Mac build/signing documentation remains. No Mac release was produced or requested.
- #120's no-key Clarify flash warning describes older behavior; the current caller gates the request and no flash was observed.
- Suggestion lookups that return a safe empty 200, and feedback's neutral 204 for another user's decision ID, are intentional and do not disclose or mutate the other account's data. Foreign writes tested here are refused. The brief's blanket 404/403 expectation is too strict.
- CSV select inference requires sufficient repeated samples. With two choices and fewer than four rows, keeping text is correct. Four rows produced select, and leading-zero ZIP identifiers remained text.
- The new `focus` and portability PostgreSQL integration tests are not included in `make test-chat-integration`; they skip without the integration env. I additionally ran all Go tests with `CHAT_TEST_ENV` set and portability integration enabled. Consider including these packages in the root target so normal review instructions run them.
- The first `make check` failure came from stale generated Next.js types, not source type errors. The production build regenerated them; subsequent full checks passed.
- No live provider outage, 30-day/21-day aging UI experiment, full-calendar capacity fixture, live receipt extraction, or every optional menu/clipboard interaction was completed. Their rows explicitly distinguish automated coverage from missing live coverage.
- Extra Dashboard cards on unmerged `feature/dashboard-cards`, deliberately omitted plan items 74/81–84, Mac releases, and web-only keyboard/mouse tips on phone were not counted as missing features.

## Cleanup and retained artifacts

The owner's original Smart suggestions and deep-work settings were restored. The four main-account QA fixtures created during the initial sweep (two tasks, one doc, one sheet) and their embeddings were removed by exact ID and owner ID; existing user items were not deleted. [Cleanup evidence](evidence/main-fixture-cleanup.log).

All later mutations used isolated QA accounts/schema or the packaged app's separate test database. Temporary MCP keys were revoked. Temporary Go helpers under the app were removed; their source is retained as `.go.txt` evidence. No application source, Makefile, migration, dependency, env file, or lockfile change is part of this review. Only this report, QA scripts, logs, JSON evidence, and screenshots are added.

Review-only servers, packaged process, and scratch-schema cleanup are recorded in [final cleanup](evidence/final-cleanup.log). No emulator was started or left running. Screenshots prefixed `mock-` came from the existing mocked chat audit; all others are live screens. Provider keys were not saved in evidence.

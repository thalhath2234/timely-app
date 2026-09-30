# Timely QA and audit — 2026-10-01

**Release recommendation: hold.** The audit reproduced unauthorized session revocation and loss of offline mobile changes after restart. The web lint gate and dependency checks also fail. No product fixes were made in this audit.

Audited commit: `453dc59262bd28d9300b8810b572fb586c2755a8`, plus the audit scripts and Make targets added here. Scope: web UI, Android app in Expo Go, supporting API, and Linux Electron smoke/static review. This is broad development QA, not an exhaustive production penetration test or device certification.

## Executed checks

| Check from repository root                                                 | Result                                                                                                    | Evidence                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `make typecheck-web`                                                       | PASS, web and Electron TypeScript                                                                         | [Output](evidence/web-typecheck.txt)                       |
| `make build-web`                                                           | PASS, all 21 routes generated                                                                             | [Output](evidence/web-build.txt)                           |
| `make lint-web`                                                            | FAIL, 11 errors and 9 warnings                                                                            | [Output](evidence/web-lint.txt)                            |
| `make typecheck-mobile`                                                    | PASS                                                                                                      | [Output](evidence/mobile-checks.txt)                       |
| `make test-mobile-assistant`                                               | PASS, 6 tests                                                                                             | [Output](evidence/mobile-checks.txt)                       |
| `make test-sheet-formulas`                                                 | PASS, 66 tests across web/mobile helpers                                                                  | [Output](evidence/mobile-checks.txt)                       |
| `make lint-api test-api`                                                   | PASS, vet and all Go test packages                                                                        | [Output](evidence/go-checks.txt)                           |
| `make test-chat-integration`                                               | PASS, real PostgreSQL integration tests                                                                   | [Output](evidence/chat-integration.txt)                    |
| `make test-portability-integration`                                        | PASS, PostgreSQL restore tests with transaction rollback                                                  | [Output](evidence/postgres-restore.txt)                    |
| `make audit-qa-api`                                                        | FAIL, 17 scenario groups passed and 1 failed                                                              | [Structured results](evidence/api-audit.json)              |
| `make audit-mobile-offline`                                                | FAIL, paused mutation never reaches persistence                                                           | [Probe evidence](evidence/offline-mutation.json)           |
| `make audit-dependencies`                                                  | FAIL, 41 production advisories: 3 critical, 19 high, 17 moderate, 2 low                                   | [Full scanner JSON](evidence/javascript-dependencies.json) |
| `make audit-api-dependencies`                                              | FAIL, 2 vulnerabilities reported at reachable symbols; another 18 module findings without reachable calls | [Output](evidence/go-vulnerabilities.txt)                  |
| `make check-mobile-deps`                                                   | FAIL, 7 Expo package versions behind the SDK's recommended patch versions                                 | [Output](evidence/expo-dependencies.txt)                   |
| `make audit-desktop AUDIT_PORT=4002 AUDIT_ELECTRON_BIN=<installed binary>` | PASS, own shell compiles and opens a Timely renderer under Xvfb                                           | [Output](evidence/electron-smoke.txt)                      |

The Next production build ran before local API environment setup; it validates compilation and route generation. Interactive QA used the development servers on web **4002**, API **8081**, and Metro **8082**. Ports 4001 and 8080 were not touched. Integration tests were rerun after local environment setup; their initial missing-environment failures were setup issues.

## Findings

### QA-01 — P1: logout accepts a session ID from an invalid JWT

**Reproduced against the API, affecting both clients.** [Handler](../../../apps/api/internal/features/auth/handler.go), `Logout` at line 121 and `sessionIDFromRequest` at line 342: the parse-error branch returns the unverified claim's session ID, which logout then revokes.

Minimal reproduction, implemented in `make audit-qa-api`:

1. Create a disposable account and log in to obtain a valid access token and its session ID.
2. Construct a JWT with that session ID and an invalid signature. No valid identity or expiry claims are needed.
3. Verify the forged token receives HTTP 401 from `/me`, while the valid token still receives 200.
4. Send the forged token to `POST /logout`; it returns 200.
5. The original valid token now receives 401. A different session remains usable.

An attacker must know the target's unguessable session ID. The audit demonstrated unauthorized revocation, not account data access or a method to discover other people's session IDs. Reject claims when signature verification fails; accept session revocation only from authenticated claims or a validated refresh token. Keep this regression in the auth tests.

### QA-02 — P1: offline mobile completion changes disappear after restart

**Reproduced on Android.** On a completed task, disable networking, tap Undo, and restart Expo Go before reconnecting. The UI optimistically changes to Done, but the offline banner shows no pending saved changes. After networking resumes, the task is still completed on the server; the user's change has disappeared. The opposite completion direction was also observed to remain in memory until connectivity resumed without a restart.

[Root query configuration](../../../apps/mobile/app/_layout.tsx), line 19, configures query defaults only. [ConnectivityBanner](../../../apps/mobile/components/ConnectivityBanner.tsx), line 26, marks TanStack Query offline. [useSaveTask](../../../apps/mobile/lib/hooks.ts), line 356, uses the default mutation network mode. Its optimistic callback runs, but the mutation function pauses before [the API queue](../../../apps/mobile/lib/api/client.ts), line 108, can persist the change. The root does not hydrate a persisted mutation cache after restart.

The isolated probe matching this configuration reports `paused: true`, **zero calls to persistence**, and zero mutations in a restarted QueryClient. It supplements the native reproduction; it is not a full app integration test and must be updated if the app's configuration changes.

Make safe offline mutations reach the existing durable queue even when TanStack Query is offline, or persist and hydrate paused mutations. Preserve the restrictions on writes that the API deliberately does not queue. Verify queue count, optimistic status consistency, app termination, reconnection, replay, and account switching.

Evidence: [offline Undo UI](evidence/android-offline-undo.png), [offline completion UI](evidence/android-offline-completion.png), [framework probe](offline-mutation-probe.mjs).

### QA-03 — P2: default timezone differs between scheduling and waiting-list ranking

**Reproduced with a new account without saved working hours.** Browser timezone was Asia/Tokyo, with the UTC date still September 30 and local date October 1. Auto-schedule used the browser timezone and placed tasks at October 1, 09:00 local. The calendar showed the placements while the waiting rail still counted both tasks as unscheduled; reloading did not resolve it.

`GET /schedule/working-hours` without a timezone returned default UTC. [Rank](../../../apps/api/internal/features/schedule/service.go), line 824, computes today's ranking with `hours.Location(time.UTC)` at line 836, whereas planning accepts the request timezone. Saving the same default hours with timezone Asia/Tokyo made the waiting list empty without moving the blocks.

Use a consistent account timezone for ranking and planning, including new accounts. Persist it during onboarding or apply one shared fallback. Add a regression around opposite UTC/local calendar dates. This finding concerns inconsistent default day boundaries; future scheduled blocks can correctly remain unscheduled for today's ranking under the documented domain rules.

Evidence: [calendar schedule preview](evidence/web-schedule-preview.png). The screenshot records the placements/rail state; the timezone diagnosis used the endpoint comparison above.

### QA-04 — P1: dependency security gates fail

**Scanner findings; exploitation was not attempted.** The 41 JavaScript entries are advisories, not 41 independently demonstrated application exploits. Review applicability while updating the lockfile and rerun both security checks.

- Next is pinned to 16.2.3. The Image Optimization AVIF RCE advisory applies to versions below 16.3.3. Timely uses `next/image` for chat attachments, so this surface warrants immediate attention. The scanner also flags Windows-hosted RCE and `next/og` RCE; the audit ran on Linux and found no `ImageResponse`/`next/og` use, so those two exploit paths were not established. See the [AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) and [next/og advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). Choose a supported version resolving all current Next advisories rather than stopping at the first patch threshold.
- Tiptap core has inherited executable DOM attribute and Markdown parsing findings. The scanner's patch thresholds are 3.30.4 and 3.30.5 respectively. The mobile editor also imports Tiptap 3.29.2 from `esm.sh`; a workspace dependency bump alone does not update those pinned browser imports. See the [attribute advisory](https://github.com/advisories/GHSA-cp6q-959q-f8rh).
- Sharp and other transitive packages also need resolution; see the complete scanner JSON for affected ranges and paths.
- Go reports Echo v5.1.1 affected by an encoded-slash static-route bypass, fixed in v5.2.0, and `golang.org/x/text` v0.36.0 affected by an invalid-input infinite loop, fixed in v0.39.0. The Echo report is marked unreviewed in the Go database and has broad middleware symbol annotations; scanner reachability through CORS/Recover is not proof Timely exposes the vulnerable static-file configuration. Assess the actual routing configuration during remediation. Sources: [Echo report](https://pkg.go.dev/vuln/GO-2026-6293), [x/text report](https://pkg.go.dev/vuln/GO-2026-5970).

### QA-05 — P2: web lint is failing

Eleven errors block the existing lint command. Errors include state updates in effects in `appShell`, `clientRuntime`, `motion`, and `taskScheduleSection`; ref access/mutation during rendering in `timeGrid`; and the slash-command ref configuration in `richTextEditor`. Nine warnings include effect dependencies and React Compiler compatibility. See [full output](evidence/web-lint.txt) for exact lines. Build/typecheck passing does not clear this gate.

### QA-06 — P2: Expo dependency compatibility check is failing

Seven packages are behind SDK 57's recommended patch versions: `expo`, `expo-constants`, `expo-document-picker`, `expo-linking`, `expo-notifications`, `expo-router`, and `expo-sharing`. Native startup worked in Expo Go, so this is a compatibility/maintenance finding, not a reproduced startup failure. Align versions through the SDK's dependency tooling and rerun typecheck, native flows, and release builds. [Exact versions](evidence/expo-dependencies.txt).

### QA-07 — P2: Electron popup guard accepts URL prefixes rather than origins

**Static review finding, not a demonstrated compromise.** [Window guard](../../../apps/web/electron/main.ts), line 182, uses `url.startsWith(origin)` to allow popups. For renderer origin `http://localhost:4002`, `http://localhost:4002@attacker.example/` passes that prefix check despite having origin `http://attacker.example`. This is a valid URL using userinfo. For an HTTPS renderer, a lookalike hostname such as `https://trusted.example.attacker.example/` also passes a prefix check for `https://trusted.example`.

Compare parsed `new URL(url).origin` exactly, as the adjacent `will-navigate` handler already does. Keep unrelated content outside the app window and reject malformed URLs. Context isolation, sandboxing, and disabled Node integration reduce exposure; this finding does not establish remote code execution.

## Interactive coverage

| Area                   | Verified behavior                                                                                                                                                                           | Limits                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web auth/onboarding    | Required-field validation, signup, first workspace, fresh authenticated session                                                                                                             | Password reset/email delivery not exercised                                           |
| Work/inbox             | Create, rename, checklist persistence, capture, clarify consumes source item                                                                                                                | Comments verified through API; all recurrence UI combinations not exercised           |
| Scheduling/calendar    | Preview, apply, persisted blocks; API apply/undo; new-account timezone inconsistency                                                                                                        | Long mobile agenda scroll not fully verified                                          |
| Docs                   | Web rich-text save/reload; Android opens same content and saves an edit visible to API                                                                                                      | Every block type, imports and attachments not exercised                               |
| Sheets                 | Web cell value and SUM formula save/reload; Android opens both and retains formula-field focus after first character                                                                        | Android exit during an active cell draft requires follow-up; see below                |
| Web route/layout sweep | Projects, report, notifications, chat, settings, docs, sheets, tasks; no horizontal overflow at 1280×800; sampled buttons had text, aria-label, or title                                    | Not a full accessibility audit or screen-reader test                                  |
| Settings/themes        | All seven web settings sections load; light/dark switching; 1024×768 settings layout                                                                                                        | Every setting mutation not exercised                                                  |
| Android keyboard       | Task description, Quick Add, rich-text toolbar, sheet formula bar usable with keyboard; new Work saved                                                                                      | Expo development overlay can cover controls; screenshots include it                   |
| Android offline        | Optimistic completion, reconnect without restart, restart loss of completion/undo                                                                                                           | See QA-02; fresh offline rich-text editor loading also needs a test                   |
| API security/data      | Anonymous rejection, wrong password, two-account read/write isolation across resource types, foreign workspace rejection, export isolation, refresh rotation/replay rejection, valid logout | No load/fuzz testing or production penetration test                                   |
| Assistant              | UI loads; helper tests; PostgreSQL approval, stale state, lease, receipt, and image ownership tests                                                                                         | No live paid model request, real streaming/provider outage, or OS background delivery |
| Data restore           | PostgreSQL restore integration tests pass                                                                                                                                                   | No production backup restore or disaster-recovery exercise                            |
| Electron               | Worktree shell compiles and boots the Timely renderer under Xvfb; window preferences reviewed                                                                                               | Fresh shell profile; authenticated workflows and packaged releases not exercised      |

Web inspection evidence: [routes](evidence/web-routes.json), [settings](evidence/settings-tabs.json), [dark](evidence/web-settings-dark.png), [light](evidence/web-settings-light.png). Android keyboard captures: [task](evidence/android-task-keyboard.png), [Quick Add](evidence/android-add-keyboard.png), [doc](evidence/android-doc-keyboard.png), [sheet](evidence/android-sheet-keyboard.png).

## Remaining checks and environment limits

- Android sheet editing: entering a draft and leaving through the header appeared to leave the server's previous cell value intact. The value was not explicitly submitted first. This needs a controlled compare of Enter, blur, header Back, and system Back before classifying a save-loss bug. The suspected cause is that the leave guard tracks parent autosave work but not the child grid's active draft. No confirmed finding or fix is claimed.
- Android agenda: initial agenda content rendered; the longer scroll/navigation check was interrupted by emulator constraints. Home timeline scrolling with 13 scheduled entries worked. Do not count this as a full agenda-scroll pass.
- The emulator was constrained to the required 3 GB cgroup and 1536 MB guest. It hit the cgroup limit after roughly 35 minutes; the fresh short run was also unstable. This is a host/test-runner limitation, not evidence of a Timely native crash. Emulator cleanup was performed.
- No signed release APK, iOS build, physical-device battery/keyboard checks, real push delivery, packaged Windows/macOS Electron, performance load test, or full WCAG audit was run. Android evidence comes from Expo Go on the emulator.
- Local setup initially lacked app env files and an Electron binary in this worktree. Ignored local env files were configured for the isolated ports. Electron smoke testing uses the already-installed main-checkout binary with this worktree's compiled shell.

## Reproduction and audit artifacts

Run checks from the root using the Make commands above. `audit-qa-api` creates disposable randomized `example.invalid` accounts and works only against port 8081. It deletes its created work entities; last workspaces and QA accounts remain because deletion of the sole workspace is rejected. The primary interactive QA account and its small set of sample tasks/docs/sheets/calendar entries remain for review. No real user's content was edited.

`audit-mobile-offline` is a framework diagnostic reproducing the current configuration. Both diagnostic commands intentionally return nonzero while their respective bugs remain. Security scan results reflect the database at audit time and can change on a later run. Evidence excludes passwords, auth tokens, cookies, and environment secrets.

The changed repository files are audit artifacts and root Make targets. Product source and the lockfile remain unchanged. Remediation order: auth revocation and mobile offline persistence; dependency upgrades and applicability review; timezone consistency; lint/Expo alignment and popup-origin guard; then finish the device/release coverage gaps.

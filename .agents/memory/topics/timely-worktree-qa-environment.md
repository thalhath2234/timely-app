---
name: timely-worktree-qa-environment
description: "Non-obvious traps when verifying Timely in a worktree (web 4002, API 8081, Metro 8082, capped emulator, APK script side effects)"
metadata:
  type: project
  modified: 2026-10-15T18:10:21.409Z
---

Lessons from the 2026-10-01 remediation session (docs/qa/2026-10-01-remediation/README.md).

- `pnpm install` that swaps Next underneath a running `next dev` leaves the old process answering HTTP 500 (`validationLevel` error). Restart the 4002 dev server after dependency upgrades before browser or Electron checks.
- The Electron smoke (`make audit-desktop ... AUDIT_ELECTRON_BIN=/home/thalhath/Dev/timely-app/apps/web/node_modules/electron/dist/electron`) only lists a page when the web server answers <500; poll `http://127.0.0.1:4061/json/list`. Kill it with `pkill -f "[t]imely-design-audit-electron"` (bracket trick, or pkill kills the calling shell).
- Expo Go on the `timely_pixel` AVD keeps the previous session; `adb shell pm clear host.exp.exponent` before using a disposable account. `make dev-mobile` run with `CI=1` disables Metro watch/reload.
- On the device, swipes that start on the "Meet your assistant" toast (bottom of lists) do not scroll; tap "Got it" first. The Reanimated reduced-motion LogBox opens easily; dismiss at (65,796) on the 390x844 override.
- In the mobile SheetGrid, a second tap on an already selected cell starts in-cell editing; tapping the formula bar starts a formula-bar draft.
- `make build-apk` rewrites `apps/mobile/lib/api/bundledUrl.ts` with the baked URL; restore it with `git checkout` after the build so the committed ngrok value is not changed. The APK lands in `apps/mobile/timely-release-arm64.apk` (git-ignored).
- Never `pkill -f` on `apps/api/tmp/main`: it also matches the main checkout's `tmp/main.exe` under the user's `make dev` and kills the 8080 API. Find the worktree `air` by `API_PORT=8081` (`PORT=8081` on branches from before the single root `.env`, 2026-10-02) in `/proc/<pid>/environ`, or match `[t]3code-<id>/apps/api/tmp/main`. The orphaned `air` does not rebuild on a bare `touch`; restart it via `make dev-api` or run its built binary.
- The Makefile does `-include .env`, so `EXPO_PUBLIC_API_URL=… make dev-mobile` still bundles the `.env` (ngrok) URL. Pass it as a make argument: `CI=1 make dev-mobile EXPO_PUBLIC_API_URL=http://10.0.2.2:8081`. Confirm by grepping the served bundle for `EXPO_PUBLIC_API_URL`. Open a chat on the device with `exp://127.0.0.1:8082/--/assistant?chatId=<id>`.
- `next dev` allows one server per app directory. When the user runs 4001 from the main checkout, run 4002 from a temporary `git worktree` with the diff applied (`pnpm install --prefer-offline` takes about 45 s).
- Widget/native QA on the `timely_pixel` AVD (x86_64) needs `TIMELY_ANDROID_ARCHITECTURES=x86_64 TIMELY_APK_OUT=.../timely-release-x86_64.apk scripts/build-apk.sh`; the default arm64 APK crashes there (`libreactnative.so` not found). Stop the emulator during the 12G build.
- `adb root` restarts adbd and silently drops `adb reverse` tunnels: re-run `adb reverse tcp:8081 tcp:8081` after it, or every API call from the device fails quietly (looked like a widget bug on 2026-10-16). Use `adb shell kill -9` (after root) to simulate a low-memory kill; `am force-stop` also cancels every widget PendingIntent.
- pnpm 11 ignores `pnpm.overrides` in package.json; put `overrides:` in `pnpm-workspace.yaml`.
- The live harness and the offline probe write reruns to `docs/qa/2026-10-01-remediation/evidence/` (`QA_EVIDENCE_FILE` overrides); the audited outputs in `docs/qa/2026-10-01/evidence/` are historical.

**Why:** each of these cost real time or risked touching committed values or real accounts.
**How to apply:** check these before starting worktree QA; see [timely-personal-use-ui-setup](timely-personal-use-ui-setup.md) for the product context.

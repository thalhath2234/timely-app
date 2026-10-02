# Timely Android (Expo)

Native client for the Go API in [`apps/api`](../api). Keep the API running while developing (`make dev-api`, or `make dev-worktree-api` on port 8081 in this worktree).

Part of the `timely` monorepo: install dependencies with `pnpm install` from the repo root, and use `make dev-mobile` / `make build-apk` (see the root [README](../../README.md)).

## API URL

Run `make setup-env` from the repository root, then set
`EXPO_PUBLIC_API_URL` in the root `.env`:

```ini
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080
```

For this worktree's API on port 8081, use
`http://10.0.2.2:8081` on the Android emulator or
`http://<your-pc-lan-ip>:8081` on a phone. Use a reachable HTTPS URL if the
phone is outside the local network. The URL is baked into a release APK at
build time; pass `API_URL=...` to `make build-apk` when needed.

The root `.env` is ignored by Git and listed in the repository's
`.worktreeinclude`, so compatible worktree tools copy it automatically. The
setup target provides the same behavior in T3 Code worktrees.

Fallbacks if the URL is omitted:

- Android emulator: `http://10.0.2.2:8080` (this maps to the host machine’s `localhost`)
- Physical phone on the same Wi-Fi: `http://<your-pc-lan-ip>:8080`
- iOS simulator / web: `http://localhost:8080`

Ngrok free URLs serve an interstitial unless every request includes `ngrok-skip-browser-warning: true`. `lib/api/client.ts` (and the doc watch stream) add that header automatically when the API URL contains `ngrok`.

The app stores the JWT in SecureStore and sends `Authorization: Bearer <token>`.

## Run

```bash
make dev-mobile              # Metro on :8082
make dev-mobile-device       # Expo Go on a USB phone, with adb reverse for Metro
make emu-start               # memory-capped AVD; make emu-stop when done
```

Release APK (memory-capped detached build, with `make` waiting for completion):
`make build-apk [API_URL=https://...]` from the repo root.

`make dev-mobile` uses Metro port 8082 so the worktree API can use 8081. Stop
the emulator with `make emu-stop` after a check.

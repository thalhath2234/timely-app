# Timely Android (Expo)

Native client for the Go API in [`apps/api`](../api). Keep the API running while developing (`make dev-api`, or `make dev-worktree-api` on port 8081 in this worktree).

Part of the `timely` monorepo: install dependencies with `pnpm install` from the repo root, and use `make dev-mobile` / `make build-apk` (see the root [README](../../README.md)).

## Connecting to a server

The phone learns its server at runtime; nothing is baked into the APK. On first
launch the app opens the **Connect** screen (`app/connect.tsx`):

- **Scan the QR code** shown by the desktop app under Settings → Server. It
  encodes `{ "v": 1, "name": "<computer>", "urls": [<tailscale url>, <loopback url>] }`.
- **Or paste an address** such as `http://100.101.102.103:48080`. Only
  `http://` and `https://` URLs are accepted; a trailing slash is dropped.

The app calls `GET /health` on each address in order (2.5 s timeout each, all
probed at once, the first in list order that answers wins), stores the whole
list in SecureStore (`lib/server`), and remembers the address that answered.
Every cold start re-checks, trying the remembered address first; when nothing
answers the last address is kept so the offline queue and the connectivity
banner keep working. Addresses are used over Tailscale, so plain `http` stays
inside the WireGuard tunnel.

Settings → **Server** (`app/(app)/settings/server.tsx`) shows the current
address, name, version and health, the other known addresses, a
"Check again" button, and "Change server", which opens the Connect screen
and signs you out of the previous server once the new one answers (tokens
belong to one server).

### Development fallback

Dev builds (`__DEV__`) fall back to `EXPO_PUBLIC_API_URL` when no server has
been paired, so emulator work needs no QR code. Set it in the root `.env`
(`make setup-env` creates it) or in the environment:

```ini
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080
```

For this worktree's API on port 8081 use `http://10.0.2.2:8081` on the Android
emulator or `http://<your-pc-lan-ip>:8081` on a phone. Without the variable the
emulator uses `http://10.0.2.2:8080` and the iOS simulator / web
`http://localhost:8080`; a physical Android device with nothing configured goes
to the Connect screen. The fallback lives in `lib/api/bundledUrl.ts`, which
release builds never load, and `scripts/check-release-bundle.js` fails the APK
build if a development address ends up in the bundle.

Ngrok free URLs serve an interstitial unless every request includes `ngrok-skip-browser-warning: true`. `lib/api/client.ts` (and the doc watch stream and downloads) add that header automatically when the active address contains `ngrok`.

The app stores the JWT in SecureStore and sends `Authorization: Bearer <token>`.

## Run

```bash
make dev-mobile              # Metro on :8082
make dev-mobile-device       # Expo Go on a USB phone, with adb reverse for Metro
make emu-start               # memory-capped AVD; make emu-stop when done
```

Release APK (memory-capped detached build, with `make` waiting for completion):
`make build-apk` from the repo root. `API_URL=...` is optional and only sets the
dev-build default; release APKs pair at runtime. After adding a native module
(such as `expo-camera`) delete `apps/mobile/android` so the build re-runs
`expo prebuild` and picks up the config plugins.

`make dev-mobile` uses Metro port 8082 so the worktree API can use 8081. Stop
the emulator with `make emu-stop` after a check.

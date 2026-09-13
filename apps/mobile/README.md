# Timely Android (Expo)

Native client for the Go API in [`apps/api`](../api). Keep the API running on `:8080` (`make dev-api` from the repo root) while developing.

Part of the `timely` monorepo: install dependencies with `pnpm install` from the repo root, and use `make dev-mobile` / `make build-apk` (see the root [README](../../README.md)).

## API URL

Set `EXPO_PUBLIC_API_URL` in `.env` (this directory). Current tunnel:

```
EXPO_PUBLIC_API_URL=https://4ee3-2405-1204-c198-100-7d39-2a83-390d-65b3.ngrok-free.app
```

Fallbacks if `.env` is omitted (also used as comments in `.env`):

- Android emulator: `http://10.0.2.2:8080` (this maps to the host machine’s `localhost`)
- Physical phone on the same Wi-Fi: `http://<your-pc-lan-ip>:8080`
- iOS simulator / web: `http://localhost:8080`

Ngrok free URLs serve an interstitial unless every request includes `ngrok-skip-browser-warning: true`. `lib/api/client.ts` (and the doc watch stream) add that header automatically when the API URL contains `ngrok`.

The app stores the JWT in SecureStore and sends `Authorization: Bearer <token>`.

## Run

```bash
make dev-mobile              # from the repo root, or:
pnpm --filter @timely/mobile start --android
```

Release APK (memory-capped, detached): `make build-apk [API_URL=https://...]` from the repo root.

On the Android emulator, Expo Go should open `exp://127.0.0.1:<port>` with `adb reverse tcp:<port> tcp:<port>` so the device can reach Metro. If Expo Go is already installed, you can also run:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

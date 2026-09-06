# Timely Android (Expo)

Native client for [timely-api](../timely-api). Keep the Go API running on `:8080` while developing.

## API URL

Set `EXPO_PUBLIC_API_URL` in `.env`. Current tunnel:

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
npx expo start --android
```

On the Android emulator, Expo Go should open `exp://127.0.0.1:<port>` with `adb reverse tcp:<port> tcp:<port>` so the device can reach Metro. If Expo Go is already installed, you can also run:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

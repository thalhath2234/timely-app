# Timely Android (Expo)

Native client for [timely-api](../timely-api). Keep the Go API running on `:8080` while developing.

## API URL

Set `EXPO_PUBLIC_API_URL` in `.env`:

- Android emulator: `http://10.0.2.2:8080` (this maps to the host machine’s `localhost`)
- Physical phone: `http://<your-pc-lan-ip>:8080`

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

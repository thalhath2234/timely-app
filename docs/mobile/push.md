# Instant push on the phone

Without push, the phone checks the server for new alerts about every 15 minutes
in the background. With push, bot alerts, reminders and digests arrive within
seconds, even when Timely is closed. Push goes through Expo's push service, which
hands Android notifications to Firebase Cloud Messaging (FCM). Both are free.

The repo ships with neither an Expo project nor a Firebase file, so a build made
without them keeps the 15-minute checks and shows "Instant push: Off" with the
reason in Settings › Notifications. Nothing in the code changes when you add
them; these steps are a one-time job for the maintainer.

## Steps

1. **Expo project.** Make a free account at <https://expo.dev>, create a project
   for the app (slug `timely-mobile`), and copy its project id (a UUID, shown on
   the project's page).
2. **Firebase project.** In the [Firebase console](https://console.firebase.google.com),
   create a project and add an Android app with the package name
   `com.timely.mobile`. Download its `google-services.json`.
3. **Give Expo the FCM key.** Create a service account key for FCM V1 in Firebase
   and upload it to the Expo project, as described in
   <https://docs.expo.dev/push-notifications/fcm-credentials/>.
4. **Tell the builds.**
   - Releases (`.github/workflows/release.yml`): set the repository variable
     `TIMELY_EAS_PROJECT_ID` to the project id, and the secret
     `GOOGLE_SERVICES_JSON_BASE64` to `base64 -w0 google-services.json`.
   - Local builds (`make build-apk`): add `TIMELY_EAS_PROJECT_ID=<id>` to the root
     `.env` and copy the file to `apps/mobile/google-services.json`. That path is
     git-ignored.

   `apps/mobile/app.config.js` reads the id (through `apps/mobile/pushConfig.js`)
   from the process env, else the root `.env`, else `app.json`'s
   `extra.eas.projectId`, and uses `google-services.json` only when it exists.
   Android needs both: a build with the id but without the file says "no push
   service set up" and keeps the 15-minute checks.

   Gradle reads `app.config.js` a second time while it builds the APK, and that
   copy is what the app reads. So the id must be in the environment of the
   Gradle build too, not only of `expo prebuild`; the release workflow sets it
   for the whole Android job and fails the build when the APK's config lacks
   it.
5. **Optional: enhanced security.** If you turn on "enhanced security for push"
   in the Expo project, create an Expo access token and set
   `TIMELY_EXPO_ACCESS_TOKEN` in the server's root `.env`. The server sends to
   Expo's default address; `TIMELY_EXPO_PUSH_URL` only points it elsewhere (a
   test server on localhost).
6. **Check it.** Install the new APK, sign in, allow notifications, and open
   Settings › Notifications. The **Instant push** row should say **On**.

## Notes

- Sending through Expo's push service is free; see Expo's push FAQ.
- iOS needs a paid Apple developer account for push and is not covered here.
- Bot alerts arrive on their own Android channel, "Bot alerts", so people can
  give them a different sound in Android's notification settings.
- A push token belongs to the sign-in that registered it. Signing the phone out,
  or signing it out from the Sessions list on another device, stops its pushes.
- Expo and Google carry the title and body of each push. "Hide alert text in
  push" in Settings › Notifications sends "A bot has news" for bot alerts
  instead; the alert itself opens in Timely.
- Tokens that Expo reports as no longer registered are removed by the server.

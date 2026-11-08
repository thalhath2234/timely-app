/**
 * Whether this phone gets instant push, in plain words for Settings ›
 * Notifications. No runtime imports, so `make test-mobile-push` can load it
 * with Node.
 */

/**
 * - on: the server has this phone's push token.
 * - unsupported: no device notifications here (web, Expo Go).
 * - no_project: the build has no Expo project id (docs/mobile/push.md), so
 *   Timely never asks for a token and keeps checking in the background.
 * - no_permission: notifications are off for Timely.
 * - failed: getting or registering the token threw.
 */
export type PushState = "on" | "unsupported" | "no_project" | "no_permission" | "failed";

export function instantPushLine(state: PushState): string {
  switch (state) {
    case "on":
      return "Bot alerts and reminders arrive in seconds, even when Timely is closed.";
    case "unsupported":
      return "Instant push works in the Android and iOS apps.";
    case "no_project":
      return "This build has no push service set up, so alerts are checked about every 15 minutes.";
    case "no_permission":
      return "Notifications are off for Timely. Turn them on to get alerts.";
    case "failed":
      return "Couldn’t reach the push service. Timely checks for alerts about every 15 minutes and tries again next time.";
  }
}

/**
 * The project id to ask Expo for a token with, from the build's
 * `extra` (app.config.js, pushConfig.js). An Android build made without
 * Firebase's google-services.json (`extra.fcm` false) cannot get a token at
 * all, so it counts as having no push project instead of failing each time.
 */
export function pushProjectId(extra: unknown, platform: string): string | null {
  const value = (extra ?? {}) as { eas?: { projectId?: unknown }; fcm?: unknown };
  const projectId = typeof value.eas?.projectId === "string" ? value.eas.projectId.trim() : "";
  if (!projectId) return null;
  if (platform === "android" && value.fcm !== true) return null;
  return projectId;
}

/**
 * What the phone keeps between runs about its push token
 * (timely-push-token.json): the token, for sign-out to revoke, and whether
 * the server pushes alerts to it. A background run starts with no memory of
 * this run's registration, so the file is how it knows not to show pushed
 * alerts a second time.
 */
export type PushRecord = { token: string; on: boolean };

export function readPushRecord(text: string | null | undefined): PushRecord | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { token?: unknown; on?: unknown };
    if (typeof parsed?.token !== "string" || !parsed.token) return null;
    // Files written before `on` existed were written only after a registration.
    return { token: parsed.token, on: parsed.on !== false };
  } catch {
    return null;
  }
}

export function pushRecordText(record: PushRecord): string {
  return JSON.stringify(record);
}

/** Whether the server pushes alerts, so the background check must skip them. */
export function pushDelivers(thisRun: boolean, record: PushRecord | null): boolean {
  return thisRun || Boolean(record?.on);
}

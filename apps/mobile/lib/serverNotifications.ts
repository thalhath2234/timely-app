import { AppState } from "react-native";
import { listNotifications } from "./api/notifications";
import { getToken } from "./auth/session";
import { documentTextFile } from "./textFile";
import { categoryFor, freshAlerts, notificationBody, type Seen } from "./notificationCategories";
import { ensureReminderChannel, getNotificationPermission, isServerPushEnabled, notificationsModule } from "./notifications";
import type { AppNotification } from "./types";

/**
 * Server alerts (a finished assistant run, overdue work, a block about to
 * start, smart suggestions) shown as phone notifications with quick actions.
 * The phone has no push service in debug-signed builds, so the app fetches
 * them itself: from the live notification's task while something runs, and
 * from a background task every 15 minutes or so otherwise.
 */

export const SERVER_PREFIX = "timely-server:";
const seenFile = documentTextFile("timely-notifications-seen.json");
const MAX_SEEN = 300;


function loadSeen(): Seen {
  try {
    const raw = seenFile.read();
    const parsed = raw ? (JSON.parse(raw) as Partial<Seen>) : null;
    return { since: typeof parsed?.since === "string" ? parsed.since : null, ids: Array.isArray(parsed?.ids) ? parsed.ids : [] };
  } catch {
    return { since: null, ids: [] };
  }
}

function saveSeen(seen: Seen) {
  try {
    seenFile.write(JSON.stringify({ since: seen.since, ids: seen.ids.slice(-MAX_SEEN) }));
  } catch {
    // Worst case an alert shows twice.
  }
}

let polling: Promise<number> | null = null;

/** Shows alerts that arrived since the last look; returns how many. */
export function pollServerNotifications(): Promise<number> {
  if (polling) return polling;
  polling = (async () => {
    const N = notificationsModule();
    // With working server push the server delivers them itself.
    if (!N || isServerPushEnabled()) return 0;
    if (!(await getToken().catch(() => null))) return 0;
    if (!(await getNotificationPermission()).granted) return 0;
    const items = await listNotifications(true);
    const now = Date.now();
    const seen = loadSeen();
    const fresh = freshAlerts(items, seen, now);
    // While the app is open the bell badge shows them; only mark them seen.
    const show = AppState.currentState !== "active";
    if (show && fresh.length) await ensureReminderChannel();
    for (const item of show ? fresh : []) {
      const categoryIdentifier = categoryFor(item) ?? undefined;
      try {
        await N.scheduleNotificationAsync({
          identifier: `${SERVER_PREFIX}${item.id}`,
          content: {
            title: item.category === "agent" ? `Assistant · ${item.title}` : item.title,
            body: notificationBody(item),
            sound: "default",
            categoryIdentifier,
            data: {
              ...(item.data ?? {}),
              notificationId: item.id,
              category: item.category,
              entityType: item.entityType ?? "",
              entityId: item.entityId ?? "",
              chatId: item.category === "agent" ? (item.entityId ?? "") : "",
            },
          },
          trigger: { channelId: item.category === "agent" ? "agent" : "reminders" },
        });
      } catch {
        // One bad alert shouldn't stop the rest.
      }
    }
    saveSeen({ since: new Date(now).toISOString(), ids: [...seen.ids, ...fresh.map((item) => item.id)] });
    return show ? fresh.length : 0;
  })().finally(() => {
    polling = null;
  });
  return polling;
}

/**
 * Quick action buttons on phone notifications. Android shows up to three per
 * notification, so each kind of alert gets the three that matter most; when
 * smart suggestions marked a next step (`data.suggest`) it comes first with a
 * ✦, as in the Notifications screen.
 *
 * No runtime imports, so `make test-mobile-live-activity` can load it with Node.
 * The API's notificationCategory (apps/api/internal/features/notify) sends the
 * same ids with server push.
 */

export type QuickAction = {
  id: string;
  title: string;
  /** Opens the app (route from the notification) instead of acting in the background. */
  opensApp?: boolean;
  /** Shows a text box on the notification; the typed text comes back with the action. */
  textInput?: { placeholder: string; submit: string };
};

const done: QuickAction = { id: "done", title: "Done" };
const focus: QuickAction = { id: "focus", title: "Start focus" };
const prioritize: QuickAction = { id: "prioritize", title: "Reschedule urgently" };
const triage = (step: string, title: string, suggested = false): QuickAction => ({
  id: `triage:${step}`,
  title: suggested ? `✦ ${title}` : title,
});
const open = (title: string): QuickAction => ({ id: "open", title, opensApp: true });
const reply: QuickAction = {
  id: "reply",
  title: "Reply",
  textInput: { placeholder: "Message the assistant", submit: "Send" },
};

export const NOTIFICATION_CATEGORIES: Record<string, QuickAction[]> = {
  timely_reminder: [done, { id: "snooze:15", title: "15 min" }, { id: "snooze:60", title: "1 hour" }],
  timely_reminder_local: [done, { id: "snooze:10", title: "10 min" }, { id: "snooze:60", title: "1 hour" }],
  timely_start: [focus, done, { id: "snooze:10", title: "10 min" }],
  timely_overdue: [prioritize, done, open("Open")],
  timely_overdue_reschedule: [triage("reschedule", "Reschedule urgently", true), triage("extend", "Deadline +1 week"), done],
  timely_overdue_extend: [triage("extend", "Deadline +1 week", true), prioritize, done],
  timely_overdue_lower: [triage("lower", "Lower priority", true), prioritize, done],
  timely_missed: [focus, done, open("Open")],
  timely_missed_addtime: [triage("addtime", "Add time", true), triage("move", "Move to free time"), done],
  timely_missed_move: [triage("move", "Move to free time", true), triage("addtime", "Add time"), done],
  timely_missed_lower: [triage("lower", "Lower priority", true), done, open("Open")],
  timely_missed_recurring: [triage("lower", "Lower priority"), done, open("Open")],
  timely_suggestion_review: [open("Review"), { id: "dismiss", title: "Not now" }],
  timely_suggestion_clarify: [open("Clarify"), { id: "dismiss", title: "Not now" }],
  timely_suggestion_focus: [triage("focus", "Add to Focus", true), { id: "dismiss", title: "Not now" }],
  timely_suggestion_reschedule: [triage("reschedule", "Find time", true), { id: "dismiss", title: "Not now" }],
  timely_agent_review: [open("Review"), reply],
  timely_agent_done: [open("Open chat"), reply],
  timely_agent_failed: [open("Open chat"), { id: "retry", title: "Try again" }],
  timely_digest: [open("Open Today")],
};

/** Server push sent before these categories existed. */
export const LEGACY_OVERDUE_CATEGORY = "overdue_task";
export const LEGACY_PRIORITIZE_ACTION = "prioritize_urgent";

type NotificationLike = { category?: string; data?: Record<string, unknown> | null };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** The category (button set) for a server notification. */
export function categoryFor(item: NotificationLike): string | null {
  const data = item.data ?? {};
  const suggest = text(data.suggest);
  switch (item.category) {
    case "reminder":
      return "timely_reminder";
    case "start":
      return "timely_start";
    case "overdue":
      return suggest && NOTIFICATION_CATEGORIES[`timely_overdue_${suggest}`] ? `timely_overdue_${suggest}` : "timely_overdue";
    case "missed":
      if (data.recurring === true) return "timely_missed_recurring";
      return suggest && NOTIFICATION_CATEGORIES[`timely_missed_${suggest}`] ? `timely_missed_${suggest}` : "timely_missed";
    case "suggestion": {
      const step = text(data.action);
      return NOTIFICATION_CATEGORIES[`timely_suggestion_${step}`] ? `timely_suggestion_${step}` : null;
    }
    case "agent": {
      const status = text(data.status);
      if (status === "approval" || status === "choose") return "timely_agent_review";
      if (status === "failed") return "timely_agent_failed";
      return "timely_agent_done";
    }
    case "digest":
    case "planning":
      return "timely_digest";
    default:
      return null;
  }
}

/** Body text for a server notification on the phone: a little more than the bare title. */
export function notificationBody(item: NotificationLike & { title?: string; body?: string }) {
  const data = item.data ?? {};
  const body = item.body?.trim() ?? "";
  const status = text(data.status);
  if (item.category === "agent") {
    if (status === "approval") return "Needs your review before anything changes.";
    if (status === "choose") return "Pick where to continue.";
    if (status === "failed") return "Ran into a problem. Open the chat to see why.";
    return body || "Your assistant has finished.";
  }
  if (item.category === "suggestion" && Array.isArray(data.items)) {
    const names = data.items
      .map((entry) => (entry && typeof entry === "object" ? text((entry as { name?: unknown }).name) : ""))
      .filter(Boolean);
    if (names.length > 1) return `${body ? `${body} ` : ""}${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
  }
  return body === "Reminder" ? "" : body;
}

export type Seen = { since: string | null; ids: string[] };

const FIRST_LOOK_MS = 2 * 60 * 60_000;

type AlertLike = { id: string; category?: string; createdAt: string; snoozedUntil?: string | null };

/**
 * Which unread server alerts the phone hasn't shown yet: newer than the last
 * look (or the last two hours, the first time), not snoozed, and not
 * reminders, which the phone schedules itself to the minute (lib/notifications.ts).
 */
export function freshAlerts<T extends AlertLike>(items: T[], seen: Seen, now: number): T[] {
  const since = seen.since ? new Date(seen.since).getTime() - 60_000 : now - FIRST_LOOK_MS;
  const known = new Set(seen.ids);
  return items.filter((item) => {
    if (known.has(item.id)) return false;
    if (item.category === "reminder") return false;
    if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now) return false;
    const created = new Date(item.createdAt).getTime();
    return Number.isFinite(created) && created >= since;
  });
}

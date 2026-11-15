// The Assistant tab's one inbox: chats and Bots in one Needs you list and one
// recent list, as on the desktop. Pure, so `make test-mobile-assistant` runs it
// under Node and the tab only draws what this decides.
import { hostWaiting, questionWaiting } from "@timely/contract/agentChat";
import { checkOutcomeWords, needsReason, type AlertHeld, type BotView, type NeedsReason } from "@timely/contract/bots";

/** The fields of a chat row (GET /chats) the inbox reads. */
export type InboxChat = {
  id: string;
  title: string;
  status: string;
  unread: boolean;
  updatedAt?: string;
  kind?: string;
  botId?: string;
  question?: unknown;
  hostRequest?: unknown;
};

/** The fields of a Bot thread summary (GET /chat/bot-threads) the inbox reads. */
export type InboxThread = {
  id: string;
  botId?: string;
  draft?: boolean;
  title: string;
  unread: boolean;
  updatedAt: string;
  parkedSteps: number;
  pendingChanges: number;
  reviewCards: number;
};

export type BotNeeds = NeedsReason | "thread";

export type InboxItem =
  | { type: "chat"; id: string; title: string; at: number; unread: boolean; chat: InboxChat; needs: boolean }
  | { type: "bot"; id: string; title: string; at: number; unread: boolean; bot: BotView; needs: BotNeeds | null; thread?: InboxThread }
  | { type: "draft"; id: string; title: string; at: number; unread: boolean; thread: InboxThread; needs: null };

/** Words for why a Bot needs the person. */
export const BOT_NEEDS_WORDS: Record<BotNeeds, string> = {
  new_alert: "New alert",
  suggestion: "Suggested change",
  broken: "Needs a fix",
  needs_key: "Needs a key",
  waiting_ok: "Waiting for your OK",
  stopped: "Stopped after strikes",
  thread: "Waiting for your OK",
};

const NEEDS_RANK: Record<BotNeeds, number> = {
  thread: 0,
  new_alert: 1,
  suggestion: 2,
  broken: 3,
  needs_key: 4,
  waiting_ok: 5,
  stopped: 6,
};

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** A Bot's own thread is a chat of kind 'bot_thread'; it lives under its Bot, not among the chats. */
export function isBotThread(chat: Pick<InboxChat, "kind" | "botId">): boolean {
  return chat.kind === "bot_thread";
}

/** A chat waits on the person: a card, a review, a choice or a failure. */
export function chatNeedsYou(chat: Pick<InboxChat, "status" | "question" | "hostRequest">): boolean {
  return (
    ["approval", "choose", "failed", "host_approval"].includes(chat.status) ||
    questionWaiting(chat as Parameters<typeof questionWaiting>[0]) ||
    hostWaiting(chat as Parameters<typeof hostWaiting>[0])
  );
}

/** A Bot thread waits on the person: a parked step, a change for one tap, or a Review card. */
export function threadNeedsYou(thread: Pick<InboxThread, "parkedSteps" | "pendingChanges" | "reviewCards">): boolean {
  return thread.parkedSteps + thread.pendingChanges + thread.reviewCards > 0;
}

/**
 * Why a Bot sits in Needs you. An alert that was held as a duplicate ("Already
 * told you") told nobody, so it never makes a "New alert" and is not counted.
 */
export function botNeeds(bot: BotView, now: Date): NeedsReason | null {
  const reason = needsReason(bot, now);
  if (reason === "new_alert" && bot.latestAlert?.held === "duplicate") return bot.suggestion ? "suggestion" : null;
  return reason;
}

export type Inbox = {
  /** Chats and Bots that wait on the person, most pressing first. */
  needs: InboxItem[];
  /** Everything else, newest first. */
  recent: InboxItem[];
};

/**
 * One inbox from the chats, the Bots and the Bot threads. A Bot whose thread
 * waits on a card, a change or a Review puts that Bot in Needs you; other
 * threads never get a row. A new Bot's draft thread is a row of its own.
 */
export function buildInbox(chats: InboxChat[], bots: BotView[], threads: InboxThread[], now: Date): Inbox {
  const byBot = new Map<string, InboxThread>();
  for (const t of threads) if (t.botId && !t.draft) byBot.set(t.botId, t);
  const items: InboxItem[] = [];
  for (const chat of chats) {
    if (isBotThread(chat)) continue;
    items.push({
      type: "chat",
      id: chat.id,
      title: chat.title,
      at: ms(chat.updatedAt),
      unread: chat.unread,
      chat,
      needs: chatNeedsYou(chat),
    });
  }
  for (const bot of bots) {
    const thread = byBot.get(bot.id);
    const reason = botNeeds(bot, now);
    items.push({
      type: "bot",
      id: bot.id,
      title: bot.name,
      at: Math.max(ms(bot.updatedAt), ms(bot.latestAlert?.createdAt), ms(thread?.updatedAt)),
      unread: !!thread?.unread || (reason === "new_alert" && bot.latestAlert?.feedback === null),
      bot,
      thread,
      needs: thread && threadNeedsYou(thread) ? "thread" : reason,
    });
  }
  for (const t of threads) {
    if (!t.draft) continue;
    items.push({ type: "draft", id: t.id, title: t.title || "New Bot", at: ms(t.updatedAt), unread: false, thread: t, needs: null });
  }
  const isNeeds = (i: InboxItem) => (i.type === "chat" ? i.needs : i.type === "bot" ? i.needs !== null : false);
  const rank = (i: InboxItem) => (i.type === "bot" && i.needs ? NEEDS_RANK[i.needs] : 0);
  const needs = items.filter(isNeeds).sort((a, b) => {
    // Chats first (a run is waiting on the person now), then Bots by reason; newest within each.
    const ta = a.type === "chat" ? -1 : rank(a);
    const tb = b.type === "chat" ? -1 : rank(b);
    return ta - tb || b.at - a.at;
  });
  const recent = items.filter((i) => !isNeeds(i)).sort((a, b) => b.at - a.at);
  return { needs, recent };
}

/** The inbox rows that match the search box (title, or a Bot's description). */
export function filterInbox(inbox: Inbox, query: string): Inbox {
  const q = query.trim().toLowerCase();
  if (!q) return inbox;
  const keep = (i: InboxItem) =>
    i.title.toLowerCase().includes(q) || (i.type === "bot" && i.bot.description.toLowerCase().includes(q));
  return { needs: inbox.needs.filter(keep), recent: inbox.recent.filter(keep) };
}

/** How many rows wait on the person: the tab badge. */
export function needsYouTotal(
  chats: InboxChat[] | undefined,
  bots: BotView[] | undefined,
  threads: InboxThread[] | undefined,
  now: Date,
): number {
  return buildInbox(chats ?? [], bots ?? [], threads ?? [], now).needs.length;
}

/** What a held alert says: the same words a check's outcome uses ("Already told you"), null when it was sent. */
export function heldWords(held: AlertHeld | string | null | undefined): string | null {
  switch (held) {
    case "duplicate":
      return checkOutcomeWords("duplicate");
    case "snoozed":
      return "Held while snoozed";
    case "cap":
      return "Held: over the day's limit";
    case "judged":
      return "Held back by AI";
    case "shared":
      return "Told you in another bot's alert";
    default:
      return null;
  }
}

/** Held alerts are muted in a list, and never count toward a badge. */
export const alertIsHeld = (held: AlertHeld | string | null | undefined): boolean => !!held;

/** The one line under a Bot row: why it needs you, else how it is doing. */
export function botRowLine(item: Extract<InboxItem, { type: "bot" }>): string {
  if (item.needs) return BOT_NEEDS_WORDS[item.needs];
  if (item.bot.status === "paused") return "Paused";
  return item.bot.health.line || "Working";
}

/** The Bot thread summary's counts as one line ("1 step waiting, 2 changes to confirm"). */
export function threadNeedsLine(thread: Pick<InboxThread, "parkedSteps" | "pendingChanges" | "reviewCards">): string {
  const parts: string[] = [];
  if (thread.parkedSteps) parts.push(`${thread.parkedSteps} ${thread.parkedSteps === 1 ? "step" : "steps"} waiting`);
  if (thread.pendingChanges) parts.push(`${thread.pendingChanges} ${thread.pendingChanges === 1 ? "change" : "changes"} to confirm`);
  if (thread.reviewCards) parts.push(`${thread.reviewCards} to review`);
  return parts.join(", ");
}

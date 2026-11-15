// The Assistant's one inbox: chats and Bots in one Needs you list and one
// recent list. Pure, so the shell only draws what this decides.
import { hostWaiting, questionWaiting } from "@timely/contract/agentChat";
import { needsReason, type BotView, type NeedsReason } from "@timely/contract/bots";
import type { ChatSummary } from "@/app/utils/api/chat";

/**
 * A chat row as GET /chats returns it. A Bot thread is a chat with kind
 * 'bot_thread' and the Bot's id; it lives under its Bot, not among the chats.
 */
export type InboxChat = ChatSummary & { kind?: string; botId?: string };

export type InboxItem =
  | { type: "chat"; id: string; title: string; at: number; unread: boolean; chat: InboxChat; needs: boolean }
  | { type: "bot"; id: string; title: string; at: number; unread: boolean; bot: BotView; needs: NeedsReason | "thread" | null };

/** Words for why a Bot needs the person. */
export const BOT_NEEDS_WORDS: Record<NeedsReason | "thread", string> = {
  new_alert: "New alert",
  suggestion: "Suggested change",
  broken: "Needs a fix",
  needs_key: "Needs a key",
  waiting_ok: "Waiting for your OK",
  stopped: "Stopped after strikes",
  thread: "Waiting for your OK",
};

const NEEDS_RANK: Record<NeedsReason | "thread", number> = {
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

export function isBotThread(chat: InboxChat): boolean {
  return chat.kind === "bot_thread" && !!chat.botId;
}

/** A chat waits on the person: a card, a review, a choice or a failure. */
export function chatNeedsYou(chat: Pick<InboxChat, "status" | "question" | "hostRequest">): boolean {
  return (
    ["approval", "choose", "failed", "host_approval"].includes(chat.status) ||
    questionWaiting(chat) ||
    hostWaiting(chat)
  );
}

export type Inbox = {
  /** Chats and Bots that wait on the person, most pressing first. */
  needs: InboxItem[];
  /** Everything else, newest first. */
  recent: InboxItem[];
};

/**
 * One inbox from the chats and the Bots. A Bot thread that waits on a card
 * puts its Bot in Needs you ("thread"); other Bot threads never get a row.
 */
export function buildInbox(chats: InboxChat[], bots: BotView[], now: Date): Inbox {
  const threadWaiting = new Set(chats.filter((c) => isBotThread(c) && chatNeedsYou(c)).map((c) => c.botId as string));
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
    items.push({
      type: "bot",
      id: bot.id,
      title: bot.name,
      at: Math.max(ms(bot.updatedAt), ms(bot.latestAlert?.createdAt)),
      unread: bot.latestAlert != null && bot.latestAlert.feedback === null && needsReason(bot, now) === "new_alert",
      bot,
      needs: threadWaiting.has(bot.id) ? "thread" : needsReason(bot, now),
    });
  }
  const isNeeds = (i: InboxItem) => (i.type === "chat" ? i.needs : i.needs !== null);
  const needs = items.filter(isNeeds).sort((a, b) => {
    const rank = (i: InboxItem) => (i.type === "bot" && i.needs ? NEEDS_RANK[i.needs] : 0);
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

/** How many rows wait on the person: the nav badge. */
export function needsYouTotal(chats: InboxChat[] | undefined, bots: BotView[] | undefined, now: Date): number {
  return buildInbox(chats ?? [], bots ?? [], now).needs.length;
}

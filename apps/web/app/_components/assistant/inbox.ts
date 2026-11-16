// The Assistant's one inbox: chats and Bots in one Needs you list and one
// recent list. Pure, so the shell only draws what this decides.
import { hostWaiting, questionWaiting } from "@timely/contract/agentChat";
import { assistantHref } from "@timely/contract/assistant";
import { needsReason, type BotView, type NeedsReason } from "@timely/contract/bots";
import type { BotThreadSummary, ChatSummary } from "@/app/utils/api/chat";

/**
 * A chat row as GET /chats returns it. A Bot thread is a chat with kind
 * 'bot_thread' and the Bot's id; it lives under its Bot, not among the chats.
 */
export type InboxChat = ChatSummary & { kind?: string; botId?: string };

/**
 * Why a Bot's thread needs the person: a parked step, a change waiting for
 * one tap, an alert's Review card, or a new Bot not yet created ("draft").
 */
export type ThreadNeeds = "parked" | "change" | "review" | "draft";
export type BotNeeds = NeedsReason | "thread" | ThreadNeeds;

/** A new Bot not yet created: its draft thread. */
export type DraftItem = {
  type: "draft";
  id: string;
  title: string;
  at: number;
  unread: boolean;
  thread: BotThreadSummary;
  needs: "draft";
  href: string;
  waiting?: number;
};

/** The older drafts folded into one row ("3 unfinished Bots") that opens to list them. */
export type DraftsItem = {
  type: "drafts";
  id: string;
  title: string;
  at: number;
  unread: boolean;
  drafts: DraftItem[];
  needs: null;
};

export type InboxItem =
  | { type: "chat"; id: string; title: string; at: number; unread: boolean; chat: InboxChat; needs: boolean }
  | {
      type: "bot";
      id: string;
      title: string;
      at: number;
      unread: boolean;
      bot: BotView;
      needs: BotNeeds | null;
      /** Where the row opens when it is not the Bot's page: its thread. */
      href?: string;
      /** Parked steps, changes and Review cards waiting in its thread. */
      waiting?: number;
    }
  | DraftItem
  | DraftsItem;

/** Id of the one summary row for older drafts. */
export const OLDER_DRAFTS_ID = "older-drafts";

/** "1 unfinished Bot", "3 unfinished Bots". */
export const unfinishedWords = (count: number): string => `${count} unfinished ${count === 1 ? "Bot" : "Bots"}`;

/** Words for why a Bot needs the person. */
export const BOT_NEEDS_WORDS: Record<BotNeeds, string> = {
  new_alert: "New alert",
  suggestion: "Suggested change",
  broken: "Needs a fix",
  needs_key: "Needs a key",
  waiting_ok: "Waiting for your OK",
  stopped: "Stopped after strikes",
  thread: "Waiting for your OK",
  parked: "Waiting for your OK",
  change: "Change waiting for one tap",
  review: "Review a proposed change",
  draft: "Finish setting up",
};

const NEEDS_RANK: Record<BotNeeds, number> = {
  thread: 0,
  parked: 0,
  change: 0.1,
  review: 0.2,
  draft: 0.3,
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

const isNeeds = (i: InboxItem) => (i.type === "chat" ? i.needs : i.needs !== null);

/** Chats first (a run is waiting on the person now), then Bots by reason; newest within each. */
function sortInbox(items: InboxItem[]): Inbox {
  const rank = (i: InboxItem) => (i.type === "chat" ? -1 : i.needs ? NEEDS_RANK[i.needs] : 0);
  const needs = items.filter(isNeeds).sort((a, b) => rank(a) - rank(b) || b.at - a.at);
  const recent = items.filter((i) => !isNeeds(i)).sort((a, b) => b.at - a.at);
  return { needs, recent };
}

/**
 * Why a Bot thread needs the person, from the counts GET /chat/bot-threads
 * gives: a parked step first, then a change waiting for a tap, then a Review
 * card. Null when it waits on nothing.
 */
export function threadNeeds(thread: BotThreadSummary): { needs: ThreadNeeds | "thread"; waiting: number } | null {
  const waiting = (thread.parkedSteps || 0) + (thread.pendingChanges || 0) + (thread.reviewCards || 0);
  if (thread.parkedSteps > 0) return { needs: "parked", waiting };
  if (thread.pendingChanges > 0) return { needs: "change", waiting };
  if (thread.reviewCards > 0) return { needs: "review", waiting };
  return thread.needsYou ? { needs: "thread", waiting } : null;
}

/** The words under a Bot row's name: why it needs the person, and how many things wait. */
export function botNeedsLine(item: Extract<InboxItem, { type: "bot" | "draft" }>): string {
  if (!item.needs) return "";
  const words = BOT_NEEDS_WORDS[item.needs];
  return item.waiting && item.waiting > 1 ? `${words} · ${item.waiting} waiting` : words;
}

const draftItem = (thread: BotThreadSummary): DraftItem => ({
  type: "draft",
  id: thread.id,
  title: thread.title || "New bot",
  at: ms(thread.updatedAt),
  unread: thread.unread,
  thread,
  needs: "draft",
  href: assistantHref({ bot: thread.botId ?? thread.id, thread: thread.id }),
});

/**
 * Puts what Bot threads wait on into an inbox. A Bot with a parked step, a
 * change waiting for one tap or a Review card moves to Needs you and opens
 * its thread; a draft (a new Bot not yet created) gets its own "Finish
 * setting up" row. Applying it twice gives the same inbox.
 */
export function applyBotThreads(inbox: Inbox, threads: readonly BotThreadSummary[] | undefined): Inbox {
  if (!threads?.length) return inbox;
  const byBot = new Map<string, BotThreadSummary>();
  const drafts: BotThreadSummary[] = [];
  for (const thread of threads) {
    if (thread.draft) drafts.push(thread);
    else if (thread.botId) byBot.set(thread.botId, thread);
  }
  const items = [...inbox.needs, ...inbox.recent].map((item): InboxItem => {
    if (item.type !== "bot") return item;
    const thread = byBot.get(item.id);
    const why = thread ? threadNeeds(thread) : null;
    if (!thread || !why) return item;
    return {
      ...item,
      needs: why.needs,
      waiting: why.waiting,
      href: assistantHref({ bot: item.id, thread: "1" }),
      unread: item.unread || thread.unread,
      at: Math.max(item.at, ms(thread.updatedAt)),
    };
  });
  // Abandoned drafts pile up: the newest is a row of its own, the older ones
  // fold into one summary row. Drafts already in the inbox stay in the count.
  const byId = new Map<string, BotThreadSummary>();
  for (const item of items) {
    if (item.type === "draft") byId.set(item.id, item.thread);
    if (item.type === "drafts") for (const d of item.drafts) byId.set(d.id, d.thread);
  }
  for (const thread of drafts) if (!byId.has(thread.id)) byId.set(thread.id, thread);
  const kept: InboxItem[] = items.filter((i) => i.type !== "draft" && i.type !== "drafts");
  const [newest, ...older] = [...byId.values()].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  if (newest) kept.push(draftItem(newest));
  if (older.length) {
    kept.push({
      type: "drafts",
      id: OLDER_DRAFTS_ID,
      title: unfinishedWords(older.length),
      at: ms(older[0].updatedAt),
      unread: false,
      drafts: older.map(draftItem),
      needs: null,
    });
  }
  return sortInbox(kept);
}

/**
 * One inbox from the chats, the Bots and the Bot threads. A Bot thread chat
 * that waits on a card puts its Bot in Needs you ("thread"); `threads`
 * (GET /chat/bot-threads) adds parked steps, changes and Review cards. Other
 * Bot threads never get a row.
 */
export function buildInbox(
  chats: InboxChat[],
  bots: BotView[],
  now: Date,
  threads?: readonly BotThreadSummary[],
): Inbox {
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
  return applyBotThreads(sortInbox(items), threads);
}

/** The inbox rows that match the search box (title, or a Bot's description). */
export function filterInbox(inbox: Inbox, query: string): Inbox {
  const q = query.trim().toLowerCase();
  if (!q) return inbox;
  const has = (i: InboxItem) =>
    i.title.toLowerCase().includes(q) || (i.type === "bot" && i.bot.description.toLowerCase().includes(q));
  // The summary row matches through the drafts inside it, and keeps only those.
  const narrow = (items: InboxItem[]): InboxItem[] =>
    items.flatMap<InboxItem>((i) => {
      if (i.type !== "drafts") return has(i) ? [i] : [];
      const drafts = i.drafts.filter(has);
      return drafts.length ? [{ ...i, title: unfinishedWords(drafts.length), drafts }] : [];
    });
  return { needs: narrow(inbox.needs), recent: narrow(inbox.recent) };
}

/** How many rows wait on the person: the nav badge. */
export function needsYouTotal(
  chats: InboxChat[] | undefined,
  bots: BotView[] | undefined,
  now: Date,
  threads?: readonly BotThreadSummary[],
): number {
  return buildInbox(chats ?? [], bots ?? [], now, threads).needs.length;
}

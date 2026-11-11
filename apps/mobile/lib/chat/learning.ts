/**
 * The phone's rules for what the agent learned (plan 9b.4, Q-3.1): the chip
 * under an agent reply, the Keep / Discard card, "Don't learn from this
 * chat", and the lines of Settings → Agent → What Timely learned. The words
 * come from @timely/contract/agentLearning so both apps say the same thing.
 * Pure functions only, so `make test-mobile-assistant` runs them under Node.
 */
import {
  ABOUT_YOU,
  budgetMeter,
  canSaveMemoryEntry,
  cardLine,
  eventsForRun,
  learnedSummary,
  learningChip,
  pendingCard,
  projectedMemoryUse,
  statusWord,
  type BudgetMeter,
  type LearnedSkill,
  type LearningChip,
  type LearningEvent,
  type LearningSettings,
  type MemoryStore,
  type PendingCard,
  type PendingItem,
} from "@timely/contract/agentLearning";
import type { Chat, ChatMessage } from "./types";

export const LEARNED_ROUTE = "/(app)/settings/learned";
export const ACTIVITY_ROUTE = "/(app)/settings/learned/activity";
export const ABOUT_YOU_ROUTE = "/(app)/settings/learned/about";
export const WAITING_ROUTE = "/(app)/settings/learned/waiting";

/** The chat menu's switch and the line the thread shows while it is on. */
export { DONT_LEARN } from "@timely/contract/agentLearning";
export const DONT_LEARN_META = "Timely won't remember anything from it or find it when it searches your past chats.";
export { NO_LEARNING_NOTE as NOT_LEARNING_LINE } from "@timely/contract/agentLearning";
/** Skills are managed on the computer (plan 9b.4: mobile mirrors Activity, About you and Waiting for you). */
export const SKILLS_ON_COMPUTER = "Skills are managed in Timely on your computer.";

/** What one agent turn learned: the chip (applied, kept, undone) and the card (staged). */
export type TurnLearning = { chip: LearningChip | null; card: PendingCard | null; events: LearningEvent[] };

/** The chip and card for one message, from the chat's events (its agentRun). */
export function turnLearning(events: LearningEvent[] | undefined, message: Pick<ChatMessage, "agentRun" | "role">): TurnLearning {
  const none = { chip: null, card: null, events: [] };
  if (!events?.length || message.role !== "assistant" || !message.agentRun) return none;
  const turn = eventsForRun(events, message.agentRun);
  if (!turn.length) return none;
  return { chip: learningChip(turn), card: pendingCard(turn), events: turn };
}

/**
 * The message a run's learning shows under: its last reply or proposal. A
 * run's reply and proposal can both carry its agentRun; the chip goes once,
 * under the newest of them.
 */
export function learningAnchors(messages: Pick<ChatMessage, "id" | "agentRun" | "role">[]): Set<string> {
  const last = new Map<string, string>();
  for (const message of messages) if (message.role === "assistant" && message.agentRun) last.set(message.agentRun, message.id);
  return new Set(last.values());
}

/** Changes of this chat whose run has no message here (no agentRun on the server yet, or a run with no reply): shown at the end. */
export function looseLearning(events: LearningEvent[] | undefined, messages: Pick<ChatMessage, "agentRun">[]): TurnLearning {
  const runs = new Set(messages.map((m) => m.agentRun).filter(Boolean));
  const loose = (events ?? []).filter((ev) => !ev.runId || !runs.has(ev.runId));
  const sorted = [...loose].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { chip: learningChip(sorted), card: pendingCard(sorted), events: sorted };
}

/** A `learning` frame of /chats/watch is about the open chat (refetch its events). */
export function learningForChat(chatId: string | null, frame: { id: string }): boolean {
  return !!chatId && frame.id === chatId;
}

/**
 * Whether the chat menu offers "Don't learn from this chat": the chat is on
 * the agent engine (agentRun.followsLearning) and the account learns. A chat
 * already set keeps the switch so it can be turned back.
 */
export function offersDontLearn(
  chat: Pick<Chat, "noLearning" | "sensitive"> | undefined,
  agentChat: boolean,
  settings: Pick<LearningSettings, "learning"> | undefined,
): boolean {
  if (!chat) return false;
  if (chat.noLearning) return true;
  return !chat.sensitive && !!settings?.learning && agentChat;
}

/** The ids Undo takes back for a chip: every live change of the turn. */
export function undoTargets(chip: LearningChip | null): string[] {
  return chip?.eventIds ?? [];
}

/** The staged items Keep or Discard decides on a card. */
export function cardTargets(card: PendingCard | null): string[] {
  return card ? [...new Set(card.items.map((item) => item.pendingId))] : [];
}

/** Where View opens on the phone: About you for a USER.md change, else that event in Activity. */
export function viewHref(chip: LearningChip | null): string | null {
  if (!chip?.view || !chip.eventIds.length) return null;
  if (chip.view.kind === "user") return ABOUT_YOU_ROUTE;
  // eventIds is newest first (the order Undo takes them back); View opens the first change.
  return `${ACTIVITY_ROUTE}?event=${encodeURIComponent(chip.eventIds[chip.eventIds.length - 1])}`;
}

/** Where a card's View diff opens: its first item on Waiting for you. */
export function diffHref(card: PendingCard | null): string | null {
  const first = card?.items[0]?.pendingId;
  return first ? `${WAITING_ROUTE}?pending=${encodeURIComponent(first)}` : null;
}

/** The card's one line for a compact phone row: the first change and "+ N more". */
export function cardMeta(card: PendingCard): string {
  const first = card.items[0]?.line ?? "";
  const more = card.items.length - 1;
  return more > 0 ? `${first} and ${more} more` : first;
}

/** Skills the agent learned or the person's copies of bundled ones, not archived: the "14 skills" of the Settings row. */
export function learnedSkillCount(skills: Pick<LearnedSkill, "source" | "archived">[] | undefined): number {
  return (skills ?? []).filter((s) => (s.source === "learned" || s.source === "edited") && !s.archived).length;
}

/** "14 skills · About you · 1 waiting", "Off" for an account that does not learn and has nothing waiting. */
export function learnedRowMeta(
  settings: Pick<LearningSettings, "learning"> | undefined,
  skills: Pick<LearnedSkill, "source" | "archived">[] | undefined,
  waiting: number,
): string {
  if (settings && !settings.learning && waiting === 0) return "Off";
  // Skills come from the agent; without it (not started, or no runtime) the row still opens.
  if (!skills) return [ABOUT_YOU, ...(waiting > 0 ? [`${waiting} waiting`] : [])].join(" · ");
  return learnedSummary(learnedSkillCount(skills), waiting);
}

const ORIGIN_WORDS: Record<string, string> = {
  chat: "from a chat",
  review: "after a chat",
  bot: "from a bot",
  user: "by you",
  curator: "tidy-up",
  sync: "from an update",
  restore: "from a backup",
};

/** "3 min ago" style, from an RFC 3339 time. */
export function ago(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** An Activity row: what changed, then "Learned · 2 h ago · from a chat". */
export function activityRow(ev: LearningEvent, now = Date.now()): { title: string; meta: string } {
  const meta = [statusWord(ev.status), ago(ev.createdAt, now), ORIGIN_WORDS[ev.origin] ?? ""].filter(Boolean).join(" · ");
  return { title: cardLine(ev), meta };
}

/** Undo is offered for a change that is in effect (learned, or kept from Waiting for you). */
export function canUndo(ev: Pick<LearningEvent, "status">): boolean {
  return ev.status === "applied" || ev.status === "kept";
}

/** The next page's `before`: the oldest createdAt shown, or null when the page was short. */
export function nextBefore(page: LearningEvent[], limit: number): string | null {
  if (page.length < limit) return null;
  return page[page.length - 1]?.createdAt ?? null;
}

/** About you's meter, as the store will be after an edit replaces `old` with `next` (the worker checks again). */
export function projectedBudget(store: Pick<MemoryStore, "used" | "limit"> | undefined, old: string, next: string): BudgetMeter {
  return budgetMeter(projectedMemoryUse(store, old, next), store?.limit ?? 0);
}

/** An About you edit is sendable: something written, changed, and inside the budget. */
export function canSaveEntry(store: Pick<MemoryStore, "used" | "limit"> | undefined, old: string, next: string): boolean {
  return canSaveMemoryEntry(store, old, next);
}

/** A Waiting for you item (the worker's snake_case) as the event the contract's card words take. */
export function pendingAsEvent(
  item: Pick<PendingItem, "pending_id" | "kind" | "action" | "subject" | "origin" | "conversation_id" | "created_at"> &
    Pick<PendingItem, "summary" | "reason" | "tainted_sources">,
): LearningEvent {
  return {
    id: item.pending_id,
    kind: item.kind,
    action: item.action,
    subject: item.subject,
    before: "",
    after: "",
    origin: item.origin,
    conversationId: item.conversation_id ?? "",
    runId: "",
    botId: "",
    taintedSources: item.tainted_sources ?? [],
    status: "staged",
    ledgerEntryId: "",
    pendingId: item.pending_id,
    summary: item.summary ?? "",
    reason: item.reason ?? "",
    createdAt: item.created_at ?? "",
    updatedAt: item.created_at ?? "",
  };
}

/** A Waiting for you row's second line: its summary (or where it came from) and when. */
export function pendingMeta(
  item: Pick<PendingItem, "origin" | "created_at"> & { summary?: string },
  now = Date.now(),
): string {
  return [item.summary || ORIGIN_WORDS[item.origin] || "", ago(item.created_at, now)].filter(Boolean).join(" · ");
}

/** Why it waits, in the card's words (the worker's reason, or the chat's outside content). */
export function pendingWhy(item: Parameters<typeof pendingAsEvent>[0]): string {
  return pendingCard([pendingAsEvent(item)])?.why ?? "";
}

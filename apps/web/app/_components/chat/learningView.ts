import {
  eventsForRun,
  learningChip,
  pendingCard,
  type LearningChip,
  type LearningEvent,
  type LearningKind,
  type PendingCard,
  type WebSearchKeys,
} from "@timely/contract/agentLearning";

/**
 * What the chat and Settings show of what the agent learned (plan 9b.4),
 * kept free of React and the API client so scripts/chat-stream.test.mjs can
 * run it. The words come from @timely/contract/agentLearning, shared with
 * the phone.
 */

/**
 * The message each agent turn's learning shows after: the last message of
 * that run (a proposal and its reply share one run). Index → run id.
 */
export function learningAnchors(
  messages: readonly { agentRun?: string }[] | undefined,
): Map<number, string> {
  const last = new Map<string, number>();
  messages?.forEach((m, i) => {
    if (m.agentRun) last.set(m.agentRun, i);
  });
  const out = new Map<number, string>();
  for (const [run, index] of last) out.set(index, run);
  return out;
}

/** A turn's chip and Keep / Discard card, either of them null. */
export function turnLearning(
  events: LearningEvent[],
  runId: string,
): { chip: LearningChip | null; card: PendingCard | null } {
  const turn = eventsForRun(events, runId);
  return { chip: learningChip(turn), card: pendingCard(turn) };
}

/** Where View opens a change: the skill, About you or Notes in Settings. */
export function learnedHref(view: {
  kind: LearningKind;
  subject: string;
}): string {
  if (view.kind === "skill")
    return `/settings?tab=learned&skill=${encodeURIComponent(view.subject)}`;
  return `/settings?tab=learned&part=${view.kind === "user" ? "about" : "notes"}`;
}

/** One line of a unified diff, as the diff view colours it. */
export type DiffRow = {
  kind: "add" | "remove" | "context" | "hunk" | "file";
  text: string;
};

/** Splits a unified diff into rows; the file headers are kept apart. */
export function diffRows(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const line of diff.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---"))
      rows.push({ kind: "file", text: line });
    else if (line.startsWith("@@")) rows.push({ kind: "hunk", text: line });
    else if (line.startsWith("+"))
      rows.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-"))
      rows.push({ kind: "remove", text: line.slice(1) });
    else if (line.startsWith("\\")) continue;
    else rows.push({ kind: "context", text: line.replace(/^ /, "") });
  }
  while (
    rows.length &&
    rows[rows.length - 1].kind === "context" &&
    !rows[rows.length - 1].text
  )
    rows.pop();
  return rows;
}

/** Settings → Agent → Web search: what searches the web in chats (Q-3.8). */
export type WebSearchLine = {
  label: string;
  meta: string;
  /** "warn" when chats cannot search until a key is added. */
  tone: "ok" | "warn";
  /** The button that opens the key form. */
  action: "Change" | "Add a search key";
};

export function webSearchLine(
  keys: WebSearchKeys | undefined,
  providerName: string,
): WebSearchLine {
  const active = keys?.active;
  if (active) {
    const backend =
      keys?.backends.find((b) => b.id === active.backend)?.label ??
      active.backend;
    return {
      label: "Search key",
      meta: active.keyHint ? `${backend} · ${active.keyHint}` : backend,
      tone: "ok",
      action: "Change",
    };
  }
  if (keys?.providerCanSearch && providerName)
    return {
      label: "Web search",
      meta: `Uses ${providerName}’s own search`,
      tone: "ok",
      action: "Add a search key",
    };
  return {
    label: "Web search",
    meta: providerName
      ? `${providerName} can’t search the web. Add a search key.`
      : "Needs a search key",
    tone: "warn",
    action: "Add a search key",
  };
}

/** Where a skill came from, from the account's learning events. */
export type SkillOrigin = {
  /** "Learned in a chat", "You wrote it", "Suggested by a bot", … */
  label: string;
  /** The chat it came from, for a link. */
  conversationId: string;
};

const ORIGIN_WORDS: Record<string, string> = {
  chat: "Learned in a chat",
  review: "Learned after a chat",
  bot: "Suggested by a bot",
  user: "You",
  curator: "Timely",
  sync: "Came with Timely",
  restore: "Restored from a backup",
};

/**
 * The skill's provenance: the oldest event that named it (its creation, when
 * the feed still has it). Null when no event names it.
 */
export function skillOrigin(
  events: LearningEvent[],
  name: string,
): SkillOrigin | null {
  const mine = events
    .filter((ev) => ev.kind === "skill" && ev.subject === name)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const first = mine.find((ev) => ev.action === "created") ?? mine[0];
  if (!first) return null;
  return {
    label: ORIGIN_WORDS[first.origin] ?? "Learned",
    conversationId: first.conversationId,
  };
}

/** Whether a chat is one Timely learns from: it runs on the New engine. */
export function learnsInChat(
  chat: { engine?: string; runEngine?: string } | undefined,
  accountEngine: string | undefined,
): boolean {
  if (!chat) return false;
  if (chat.engine) return chat.engine === "agent";
  return chat.runEngine === "agent" || accountEngine === "agent";
}

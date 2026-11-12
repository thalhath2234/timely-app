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

/**
 * Changes of this chat whose run wrote no message here (a stopped or failed
 * run's notice carries its run, so only a run from before runs were tagged):
 * shown at the end of the chat, as on the phone (looseLearning in
 * apps/mobile/lib/chat/learning.ts).
 */
export function looseLearning(
  events: LearningEvent[] | undefined,
  messages: readonly { agentRun?: string }[] | undefined,
): { chip: LearningChip | null; card: PendingCard | null } {
  const runs = new Set((messages ?? []).map((m) => m.agentRun).filter(Boolean));
  const loose = (events ?? [])
    .filter((ev) => !ev.runId || !runs.has(ev.runId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { chip: learningChip(loose), card: pendingCard(loose) };
}

/** Whether a chat asks for its learning events: it runs on the New engine, or a reply came from it. */
export function learningFollowed(
  chat:
    | {
        engine?: string;
        runEngine?: string;
        messages?: readonly { agentRun?: string }[];
      }
    | undefined,
  accountEngine: string | undefined,
): boolean {
  if (!chat) return false;
  return (
    learnsInChat(chat, accountEngine) ||
    !!chat.messages?.some((m) => m.agentRun)
  );
}

/**
 * Where the About you or Notes entry being edited is now: the form follows
 * the entry's text, so a refetch that moves or removes entries never turns
 * Save into a change to another one. -1 once the entry is gone.
 */
export function memoryEditIndex(
  entries: readonly string[] | undefined,
  old: string,
): number {
  return entries ? entries.indexOf(old) : -1;
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
  const lines = diff.replace(/\r\n?/g, "\n").split("\n");
  for (const [i, line] of lines.entries()) {
    // File headers come in a ---/+++ pair; a lone "---" is a removed or added line (a skill's frontmatter).
    const header =
      (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) ||
      (line.startsWith("+++ ") && lines[i - 1]?.startsWith("--- "));
    if (header) rows.push({ kind: "file", text: line });
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
 * The skill's provenance: what the skills list says (Go reads the event that
 * created it, however old), else the oldest event in `events` that named it.
 * Null when neither names it.
 */
export function skillOrigin(
  events: LearningEvent[],
  name: string,
  given?: { origin?: string; conversation_id?: string },
): SkillOrigin | null {
  if (given?.origin) {
    return { label: ORIGIN_WORDS[given.origin] ?? "Learned", conversationId: given.conversation_id ?? "" };
  }
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

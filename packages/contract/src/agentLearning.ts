/**
 * What the agent learned (phase 3 of docs/plans/2026-11-08-timely-agent-from-hermes.md,
 * section 9b.4): the /agent/learning/* wire shapes, the web search key, and the
 * words both apps use for the chat chip, the Keep / Discard card, budget meters
 * and statuses. Wire shapes mirror apps/api/internal/features/learning
 * (model.go, handler.go); the skill, memory, pending and upstream lists come
 * from the agent worker as is (apps/agent/PROTOCOL.md section 10), so their
 * fields are snake_case.
 */

/** What changed: a skill, Notes (MEMORY.md) or About you (USER.md). */
export type LearningKind = "skill" | "memory" | "user";

/** applied, staged and blocked come from the agent; the person makes the rest. */
export type LearningStatus =
  | "applied"
  | "staged"
  | "blocked"
  | "undone"
  | "kept"
  | "discarded";

/** Where a change came from. */
export type LearningOrigin =
  | "chat"
  | "review"
  | "bot"
  | "user"
  | "curator"
  | "sync"
  | "restore";

/** An outside source a chat read before the change (why it was staged). */
export type LearningTaintSource = {
  kind: string;
  tool?: string;
  host?: string;
  session?: string;
};

/** One row of GET /agent/learning/events. */
export type LearningEvent = {
  id: string;
  kind: LearningKind;
  /** created, patched, edited, deleted, added, replaced, removed, archived, restored, stale. */
  action: string;
  /** The skill name, or the memory target. */
  subject: string;
  /** The text before and after (an entry for memory), each at most 20,000 characters. */
  before: string;
  after: string;
  origin: LearningOrigin | string;
  /** "" when the change came from outside a chat (Settings, the curator, a restore). */
  conversationId: string;
  /** The agent run whose turn it came from: a message's agentRun. */
  runId: string;
  botId: string;
  taintedSources: LearningTaintSource[];
  status: LearningStatus;
  ledgerEntryId: string;
  pendingId: string;
  summary: string;
  /** Why a staged change waits; "" on other events and on older rows. */
  reason?: LearningReason | string;
  /** RFC 3339 times. */
  createdAt: string;
  updatedAt: string;
};

/** Why a staged change waits for the person: the chat read outside content, a
 * bot wrote it, the learning pass would change or remove what Timely already
 * knows, or the steps name tools that need the person's OK. */
export type LearningReason = "tainted" | "bot" | "unattended" | "skill_body";

/** GET /agent/learning/events?conversationId=&status=&before=&limit=. before is
 * the createdAt of the last event already shown. */
export type LearningEventsResponse = { events: LearningEvent[] };

/** GET and PATCH /agent/learning/settings. */
export type LearningSettings = {
  learning: boolean;
  /** "Search my past chats" (Q-3.5). */
  searchHistory: boolean;
  /** "What you use Timely for" was copied into About you (Q-3.3); read only. */
  useCaseCopied: boolean;
};

/** The fields of PATCH /agent/learning/settings. */
export type LearningSettingsPatch = Partial<
  Pick<LearningSettings, "learning" | "searchHistory">
>;

/** Where a skill comes from. */
export type LearnedSkillSource =
  | "learned"
  | "edited"
  | "bundled"
  | "timely"
  | "optional";

/** One skill of GET /agent/learning/skills ({skills}). enabled and restored are
 * Timely's: restored means "restored, review" until the person turns it on. */
export type LearnedSkill = {
  name: string;
  category?: string;
  source: LearnedSkillSource;
  enabled: boolean;
  locked: boolean;
  archived: boolean;
  /** Whether Archive works for it (a learned skill; shipped ones are turned off instead). */
  archivable?: boolean;
  stale: boolean;
  restored: boolean;
  last_used?: string | null;
  created_by_event?: string | null;
};

export type LearnedSkillsResponse = { skills: LearnedSkill[] };

/** POST /agent/learning/skills/:name/state {state}. */
export type SkillState =
  | "enable"
  | "disable"
  | "lock"
  | "unlock"
  | "archive"
  | "restore"
  | "delete";

/** One memory file: its entries and its budget in characters. */
export type MemoryStore = { entries: string[]; used: number; limit: number };

/** GET /agent/learning/memory: Notes (memory) and About you (user). */
export type MemoryView = { memory: MemoryStore; user: MemoryStore };

/** POST /agent/learning/memory. old names the entry to replace or remove. */
export type MemoryEdit = {
  target: "memory" | "user";
  action: "add" | "replace" | "remove";
  content?: string;
  old?: string;
};

/** One item of GET /agent/learning/pending: a staged change waiting for Keep or Discard. */
export type PendingItem = {
  pending_id: string;
  kind: LearningKind;
  subject: string;
  action: string;
  diff: string;
  origin: LearningOrigin | string;
  conversation_id: string;
  summary?: string;
  reason?: LearningReason | string;
  tainted_sources?: LearningTaintSource[];
  /** RFC 3339. */
  created_at: string;
};

/** One item of GET /agent/learning/upstream: a bundled skill the person edited
 * whose shipped copy changed ("Updated upstream", Q-3.7). */
export type UpstreamSkill = { name: string; upstream_changed_at: string };

/** GET /agent/learning/upstream/:name. */
export type UpstreamCompare = { mine: string; upstream: string; diff: string };

/** POST /agent/learning/upstream/:name {choice}. */
export type UpstreamChoice = "keep_mine" | "use_new";

/** One web search backend a key can be saved for. */
export type WebSearchBackend = {
  id: string;
  label: string;
  keyUrl: string;
  available: boolean;
};

/** GET /agent/web-keys (Q-3.8): without a key, web search uses the chat
 * provider's own search when it can. */
export type WebSearchKeys = {
  active: { backend: string; keyHint: string } | null;
  backends: WebSearchBackend[];
  usesProvider: boolean;
  providerCanSearch: boolean;
};

/** A `learning` event on GET /chats/watch: refetch the chat's events (id is
 * the conversation, "" outside a chat) or the Settings lists. */
export type LearningWatchEvent = {
  type: "learning";
  kind: "chat";
  id: string;
  document: { eventId: string; status: LearningStatus };
};

export function isLearningWatchEvent(
  value: unknown,
): value is LearningWatchEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    type?: unknown;
    id?: unknown;
    document?: { eventId?: unknown; status?: unknown };
  };
  return (
    v.type === "learning" &&
    typeof v.id === "string" &&
    typeof v.document?.eventId === "string" &&
    typeof v.document?.status === "string"
  );
}

/** The word for each status, for the Activity list. */
export const LEARNING_STATUS_WORDS: Record<LearningStatus, string> = {
  applied: "Learned",
  staged: "Waiting for you",
  blocked: "Blocked",
  undone: "Undone",
  kept: "Kept",
  discarded: "Discarded",
};

export function statusWord(status: string): string {
  return (LEARNING_STATUS_WORDS as Record<string, string>)[status] ?? status;
}

/** Settings → Agent: the section, its parts, and the lines it shows. */
export const LEARNED_TITLE = "What Timely learned";
export const ABOUT_YOU = "About you";
export const NOTES = "Notes";
export const WAITING_FOR_YOU = "Waiting for you";
export const ACTIVITY = "Activity";
export const RESTORED_REVIEW = "Restored, review";
export const UPDATED_UPSTREAM = "Updated upstream";
/** Q-3.6: the curator marks unused skills, and never archives them. */
export const NEVER_ARCHIVES =
  "Timely never archives skills on its own. Skills you have not used for a while are marked unused.";
/** Memory is frozen into a chat when it starts. */
export const NEXT_CHAT_NOTE = "applies from your next chat";
/** The server's answer to an Undo of a change already taken back (a later
 * Undo of the same skill took it back too): the change is undone, so the
 * apps read it as done, not as an error. */
export const ALREADY_UNDONE = "Already undone";
export const DOWNLOAD_LEARNED = "Download what Timely learned";
/** The account switch, the same words on every device. */
export const LEARN_SWITCH = "Learn from chats";
/** The per-chat switch and the line the chat shows while it is on. */
export const DONT_LEARN = "Don't learn from this chat";
export const NO_LEARNING_NOTE = "Timely won't learn from this chat.";

/** "14 skills · About you · 1 waiting": the Settings row that opens the section. */
export function learnedSummary(skills: number, waiting: number): string {
  const parts = [
    `${count(skills)} ${skills === 1 ? "skill" : "skills"}`,
    ABOUT_YOU,
  ];
  if (waiting > 0) parts.push(`${count(waiting)} waiting`);
  return parts.join(" · ");
}

const SKILL_VERBS: Record<string, string> = {
  created: "created",
  patched: "updated",
  edited: "updated",
  deleted: "deleted",
  archived: "archived",
  restored: "restored",
  stale: "marked unused",
};

const MEMORY_VERBS: Record<string, string> = {
  added: "added",
  replaced: "updated",
  removed: "removed",
};

/** What changed, for the chip: "skill 'bank-csv-import' created", "note
 * added", "About you updated". */
export function changeLine(
  ev: Pick<LearningEvent, "kind" | "action" | "subject">,
): string {
  if (ev.kind === "skill")
    return `skill '${ev.subject}' ${SKILL_VERBS[ev.action] ?? "changed"}`;
  const verb = MEMORY_VERBS[ev.action] ?? "updated";
  return ev.kind === "user" ? `About you ${verb}` : `note ${verb}`;
}

/** What changed, for a card line: "Skill “flipkart-price-read” updated". */
export function cardLine(
  ev: Pick<LearningEvent, "kind" | "action" | "subject">,
): string {
  if (ev.kind === "skill")
    return `Skill “${ev.subject}” ${SKILL_VERBS[ev.action] ?? "changed"}`;
  const verb = MEMORY_VERBS[ev.action] ?? "updated";
  return ev.kind === "user" ? `About you ${verb}` : `Note ${verb}`;
}

/** The events of one agent turn (a message's agentRun), oldest first. */
export function eventsForRun(
  events: LearningEvent[],
  runId: string,
): LearningEvent[] {
  if (!runId) return [];
  return events
    .filter((ev) => ev.runId === runId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The chip under an agent reply. */
export type LearningChip = {
  /** "Learned: skill 'bank-csv-import' created", "… and 2 more", or "Undone". */
  label: string;
  /** NEXT_CHAT_NOTE when a memory change is among them, else null. */
  note: string | null;
  /** The buttons, in order: View opens the first change in Settings, Undo takes back every live one. */
  actions: ("View" | "Undo")[];
  /** The events Undo takes back, newest first: undoing a skill's change also
   * takes back that skill's later changes (the rollback writes the skill as
   * it was), so the newest go first and none is already undone when asked. */
  eventIds: string[];
  /** The first live change, for View. */
  view: { kind: LearningKind; subject: string } | null;
  /** label, note and actions joined with " · ". */
  text: string;
};

const LIVE: LearningStatus[] = ["applied", "kept"];

/** The chip for a turn's events (eventsForRun): what was learned and kept,
 * or "Undone" once every change is taken back. Staged and blocked changes are
 * not on the chip (staged ones are on the Keep / Discard card). Null when the
 * turn learned nothing. */
export function learningChip(events: LearningEvent[]): LearningChip | null {
  const shown = events.filter(
    (ev) => LIVE.includes(ev.status) || ev.status === "undone",
  );
  if (shown.length === 0) return null;
  const live = shown.filter((ev) => LIVE.includes(ev.status));
  if (live.length === 0) {
    return {
      label: "Undone",
      note: null,
      actions: [],
      eventIds: [],
      view: null,
      text: "Undone",
    };
  }
  const first = live[0];
  const more = live.length - 1;
  const label =
    `Learned: ${changeLine(first)}` +
    (more > 0 ? ` and ${count(more)} more` : "");
  const note = live.some((ev) => ev.kind !== "skill") ? NEXT_CHAT_NOTE : null;
  const actions: ("View" | "Undo")[] = ["View", "Undo"];
  const text = [label, ...(note ? [note] : []), ...actions].join(" · ");
  return {
    label,
    note,
    actions,
    eventIds: live.map((ev) => ev.id).reverse(),
    view: { kind: first.kind, subject: first.subject },
    text,
  };
}

/** One staged change on the Keep / Discard card. */
export type PendingCardItem = {
  eventId: string;
  pendingId: string;
  line: string;
  summary: string;
};

/** The card after a reply when the turn's changes wait for the person (Q-3.1:
 * the chat read outside content or a bot wrote it; also steps that name tools
 * needing the person's OK, and the learning pass changing what Timely knows). */
export type PendingCard = {
  /** "Keep what Timely learned?", or "Keep what Deals feed learned?" for a bot. */
  title: string;
  items: PendingCardItem[];
  keep: "Keep";
  discard: "Discard";
  viewDiff: "View diff";
  /** Why it waits, in one line. */
  why: string;
};

/** The Keep / Discard card for a turn's events, or null when none is staged. */
export function pendingCard(
  events: LearningEvent[],
  botName?: string,
): PendingCard | null {
  const staged = events.filter((ev) => ev.status === "staged" && ev.pendingId);
  if (staged.length === 0) return null;
  const fromBot =
    Boolean(botName) ||
    staged.some((ev) => ev.botId || ev.origin === "bot" || ev.reason === "bot");
  return {
    title: `Keep what ${botName || "Timely"} learned?`,
    items: staged.map((ev) => ({
      eventId: ev.id,
      pendingId: ev.pendingId,
      line: cardLine(ev),
      summary: ev.summary,
    })),
    keep: "Keep",
    discard: "Discard",
    viewDiff: "View diff",
    why: fromBot ? WAIT_WHY.bot : waitWhy(staged),
  };
}

/** Why a staged change waits, in one line. */
export const WAIT_WHY = {
  bot: "A bot suggested this, so it waits for you.",
  tainted: "This chat read something from outside Timely, so it waits for you.",
  skill_body: "These steps use tools that need your OK, so they wait for you.",
  unattended: "This changes or removes something Timely already knows, so it waits for you.",
  other: "Timely waits for you before saving this.",
} as const;

function waitWhy(staged: LearningEvent[]): string {
  if (
    staged.some(
      (ev) => ev.reason === "tainted" || (ev.taintedSources ?? []).length > 0,
    )
  )
    return WAIT_WHY.tainted;
  if (staged.some((ev) => ev.reason === "skill_body")) return WAIT_WHY.skill_body;
  if (staged.some((ev) => ev.reason === "unattended")) return WAIT_WHY.unattended;
  return WAIT_WHY.other;
}

/** A memory budget: "1,104 of 1,375". */
export type BudgetMeter = {
  text: string;
  ratio: number;
  tone: "ok" | "near" | "full";
};

export function budgetMeter(used: number, limit: number): BudgetMeter {
  const u = Math.max(0, Math.round(used || 0));
  const l = Math.max(0, Math.round(limit || 0));
  const ratio = l > 0 ? Math.min(1, u / l) : 1;
  const tone = u >= l ? "full" : ratio >= 0.9 ? "near" : "ok";
  return { text: `${count(u)} of ${count(l)}`, ratio, tone };
}

/**
 * Undo is offered for a change that is in effect (learned, or kept from Waiting for you) and has
 * something to take back: a skill change needs its history entry (the curator's "unused" note has none).
 */
export function canUndoLearning(ev: Pick<LearningEvent, "status"> & Partial<Pick<LearningEvent, "kind" | "ledgerEntryId">>): boolean {
  if (ev.status !== "applied" && ev.status !== "kept") return false;
  return ev.kind !== "skill" || !!ev.ledgerEntryId;
}

/**
 * Undo of a skill change puts the skill back as it was before it, so it also takes back every later
 * change to that skill still in effect (the server marks them undone). Those later changes, newest first.
 */
export function laterSkillChanges(events: LearningEvent[], ev: LearningEvent): LearningEvent[] {
  if (ev.kind !== "skill" || !ev.subject) return [];
  return events.filter(
    (other) =>
      other.id !== ev.id &&
      other.kind === "skill" &&
      other.subject === ev.subject &&
      other.createdAt > ev.createdAt &&
      canUndoLearning(other),
  );
}

/** The warning before such an Undo: "Undo also takes back 2 later changes to aisles, including your edit." */
export function undoAlsoText(ev: LearningEvent, later: LearningEvent[]): string {
  if (!later.length) return "";
  const n = later.length;
  const yours = later.some((other) => other.origin === "user") ? ", including your edit" : "";
  return `Undo also takes back ${n === 1 ? "1 later change" : `${n} later changes`} to ${ev.subject}${yours}.`;
}

/** What separates entries in About you and Notes; the budget counts it (Hermes' ENTRY_DELIMITER). */
export const MEMORY_ENTRY_DELIMITER = "\n§\n";

/**
 * Characters About you or Notes will use after an edit replaces `old` with `next`
 * (`old` empty: a new entry, which also adds a separator when there are entries already).
 * Counts code points, as the worker does; the worker checks again.
 */
export function projectedMemoryUse(store: { used: number } | undefined, old: string, next: string): number {
  const used = store?.used ?? 0;
  const text = [...next.trim()].length;
  if (!old) return used + text + (used > 0 ? [...MEMORY_ENTRY_DELIMITER].length : 0);
  return Math.max(0, used - [...old].length + text);
}

/** An About you or Notes edit is sendable: something written, changed, and inside the budget. */
export function canSaveMemoryEntry(store: { used: number; limit: number } | undefined, old: string, next: string): boolean {
  const text = next.trim();
  if (!text || text === old.trim()) return false;
  return projectedMemoryUse(store, old, next) <= (store?.limit ?? 0);
}

/** 1104 -> "1,104", the same on every device. */
function count(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

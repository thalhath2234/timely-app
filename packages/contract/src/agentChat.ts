/**
 * Chat on the agent engine (phase 2 of docs/plans/2026-11-08-timely-agent-from-hermes.md):
 * the engine a chat runs on, its permission mode, the live activity and
 * streamed reply of an agent run, and the words both apps use for them.
 * Wire shapes mirror apps/api/internal/features/chat (model.go, prefs.go).
 */

/** How much the agent may change without asking (plan 5.5b). */
export type PermissionMode = "supervised" | "auto" | "full";

/** A chat's own engine choice: "" follows the account's Settings → Agent → Engine. */
export type ChatEngine = "" | "classic" | "agent";

/** The engine an account's chats use by default (Classic until the person picks New). */
export type AccountEngine = "classic" | "agent";

/** Where Full Access may be turned on. */
export type FullAccessAllowedOn = "desktop" | "devices";

/** One line of a live agent run's activity: a tool it runs, a status it reports,
 * or a sub-task it handed work to (phase 4, label "Sub-task: <goal>"). */
export type ActivityLine = {
  id: string;
  kind: "tool" | "status" | "subagent";
  label: string;
  state: "running" | "done" | "failed";
  /** RFC 3339 time. */
  at: string;
};

/** Conversation.activity: the live run's lines and the reply streamed so far,
 * written at most once a second (late joiners start from draft). */
export type ChatActivity = {
  run?: string;
  lines?: ActivityLine[];
  draft?: string;
};

/** A `delta` event on GET /chats/watch: one chunk of a live run's reply.
 * offset is how many characters (Unicode code points) of the reply came
 * before this chunk. */
export type ChatDelta = {
  type: "delta";
  kind: "chat";
  id: string;
  document: { run: string; offset: number; text: string };
};

/** Who may answer a host card (Q-5.7): any signed-in device (a phone unlocks
 * first), or only the desktop window. */
export type HostApprovalRule = "devices" | "desktop";

/** GET /agent/chat-settings. */
export type AgentChatSettings = {
  engine: AccountEngine;
  chatPermission: PermissionMode;
  botPermission: PermissionMode;
  fullAccessAllowedOn: FullAccessAllowedOn;
  /** Phase 5: who may answer host cards, and how long a parked card waits
   * (10 to 60 minutes). Absent from an older server. */
  hostApprovalRule?: HostApprovalRule;
  hostApprovalTimeoutMinutes?: number;
  /** The step-up that turned a Full Access default on ({} when none). */
  fullAccessDefault?: FullAccessRecord;
  /** Whether the agent engine can run for this account now, and why not. */
  engineAvailable: boolean;
  engineReason: string;
};

/** The fields of PATCH /agent/chat-settings. Turning a default to Full
 * Access, Full Access "Allowed on" any device, or host cards back to any
 * device needs the step-up (the desktop window; a phone that unlocked where
 * Full Access is allowed on any device): 403 otherwise. */
export type AgentChatSettingsPatch = Partial<
  Pick<AgentChatSettings, "engine" | "chatPermission" | "botPermission" | "fullAccessAllowedOn" | "hostApprovalRule" | "hostApprovalTimeoutMinutes">
> & { device?: HostDevice };

/** The account defaults before anything is saved (Q-2.2, Q-P1, Q-5.1, Q-5.7). */
export const DEFAULT_CHAT_SETTINGS: Omit<AgentChatSettings, "engineAvailable" | "engineReason" | "fullAccessDefault"> = {
  engine: "classic",
  chatPermission: "supervised",
  botPermission: "auto",
  fullAccessAllowedOn: "desktop",
  hostApprovalRule: "devices",
  hostApprovalTimeoutMinutes: 60,
};

export const PERMISSION_MODES: readonly PermissionMode[] = ["supervised", "auto", "full"];

export type PermissionCopy = {
  name: string;
  /** The picker's line on web and desktop. */
  description: string;
  /** The phone sheet's shorter line. */
  short: string;
  /** The chip's glyph and tone as drawn: green eye, indigo shield, amber bolt. */
  icon: "eye" | "shield" | "bolt";
  tone: "green" | "indigo" | "amber";
};

/** Mode names and descriptions, the same on web, desktop and phone. Full
 * Access (phase 5) lifts host cards (commands, files, code, the browser, MCP
 * tools); changes to Timely data still follow Auto, and the floors stay. */
export const PERMISSION_COPY: Record<PermissionMode, PermissionCopy> = {
  supervised: {
    name: "Supervised",
    description: "Asks before every action: each change to your data, each command, file, web page and browser step.",
    short: "Asks before every action",
    icon: "eye",
    tone: "green",
  },
  auto: {
    name: "Auto",
    description:
      "Does the everyday work on its own. Asks before deleting, sending your data out, paying, installing, changing settings, running code, using your browser, and changes after it reads outside content.",
    short: "Asks before deleting, sending your data out, paying, installing, changing settings, running code or using your browser",
    icon: "shield",
    tone: "indigo",
  },
  full: {
    name: "Full Access",
    description:
      "Runs commands, files, code and MCP tools on this computer without a card. Your signed-in browser still asks for each step, and changes to your Timely data still ask like Auto. Commands that wipe a disk or the system are always refused. Everything is logged.",
    short: "Runs commands without a card. Timely data still asks like Auto, and so does your browser",
    icon: "bolt",
    tone: "amber",
  },
};

/**
 * How a new chat is created. Full Access needs the step-up, which only the
 * desktop window's shell bridge carries, and the bridge's fixed requests are
 * flat (no chat creation among them). So a new chat that should start in Full
 * Access, named or by the account's default, is created Supervised and turned
 * to Full Access through the bridge at once; every other chat is created as
 * chosen. The wait in between fails closed: Supervised asks before anything.
 */
export function newChatAccess(
  chosen: PermissionMode | null,
  accountDefault: PermissionMode,
  inDesktopWindow: boolean,
): { create: PermissionMode | undefined; thenFull: boolean } {
  if (inDesktopWindow && (chosen ?? accountDefault) === "full") return { create: "supervised", thenFull: true };
  return { create: chosen ?? undefined, thenFull: false };
}

/** Under the picker: the choice is the chat's own. */
export const CHAT_PERMISSION_NOTE = "Only this chat. New chats start on your default.";

/** Where Full Access cannot be turned on (the step-up, decision 7): the
 * phone, unless Full Access is allowed on any device. */
export const FULL_ACCESS_PHONE_NOTE = "Turn on from the desktop app";

/** The one-time confirmation before turning Full Access on: what it lifts and
 * what stays. */
export const FULL_ACCESS_CONFIRM =
  "Full Access lifts every card for commands, files, code and MCP tools: the assistant runs them as you on this computer. Your signed-in browser still asks for each step. Still in place: commands that wipe a disk or the system are refused, your keys stay out of its reach, other accounts stay apart, and what it learns from outside pages waits for you. Turn it on for this chat?";

/** Settings → Permissions footer: floors no mode lifts. */
export const ALWAYS_BLOCKED_NOTE = "Still blocked in every mode: commands that wipe a disk or the system, and handing out your keys.";

export type CriticalRow = {
  /** The critical-list item number in Go (agent/permission.go). */
  item: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  detail?: string;
};

/** Settings → Permissions → "Auto always asks before", as drawn. */
export const AUTO_ASKS_BEFORE: readonly CriticalRow[] = [
  { item: 1, title: "Deleting or overwriting" },
  { item: 2, title: "Sending your data out", detail: "To a site you haven’t used, or by email or post" },
  { item: 3, title: "Buying, paying or signing in" },
  { item: 4, title: "Installing software" },
  { item: 5, title: "Changing settings or permissions" },
  { item: 6, title: "Changes after reading outside content", detail: "A page, file or command output could have told it what to do" },
];

export const ENGINE_COPY: Record<AccountEngine, { name: string; description: string }> = {
  classic: { name: "Classic", description: "Timely’s assistant as it works today." },
  agent: { name: "New", description: "The new agent engine: replies stream in as they are written." },
};

/** Claude Code and Codex are not Classic-only: New runs them through the
 * server's own CLI and its sign-in (phase 2 gateway, Q-4.1). Both apps say it
 * only when New can run: when it cannot, the reason row says why. */
export const CLI_ON_NEW = "Claude Code and Codex also work on New, through the server’s CLI; their replies arrive in one piece.";

/** The Claude Code and Codex cards' line in Settings › Agent; host is where
 * the CLI runs ("the server", or "this computer" in the desktop app). */
export function cliProviderDescription(id: "claude" | "codex", host: string): string {
  return id === "claude"
    ? `Uses the Claude Code CLI and its sign-in on ${host}. Works on Classic and New, with every built-in tool disabled.`
    : `Uses the Codex CLI and its sign-in on ${host}. Works on Classic and New, in a read-only sandbox with the shell disabled.`;
}

/** What Timely learned and About you while chats run on Classic: learning, About you and
 * past-chat search happen only on the agent engine (plan 9b; Classic never reads them). */
export const LEARNS_ON_AGENT_ONLY = `Timely learns only in chats on the ${ENGINE_COPY.agent.name} engine.`;
export const CHOOSE_AGENT_ENGINE = "Choose it in Settings › Agent.";
/** The phone's row title for that notice (a row title stays on one line). */
export const LEARNING_NEEDS_AGENT = `Learning needs the ${ENGINE_COPY.agent.name} engine`;
/** About you's hint: read at the start of every chat on the agent engine, never on Classic. */
export const ABOUT_YOU_HINT = "Timely reads this at the start of every chat. Changes apply from your next chat.";
export const ABOUT_YOU_CLASSIC_HINT = `Timely reads this only in chats on the ${ENGINE_COPY.agent.name} engine. ${CHOOSE_AGENT_ENGINE}`;

/** errorAction of a run the agent engine could not start; the apps offer
 * USE_CLASSIC_LABEL, which sends PATCH {engine: "classic"} and then Retry. */
export const USE_CLASSIC_ACTION = "use_classic";
export const USE_CLASSIC_LABEL = "Use classic for this chat";

/** A live run's reply as streamed so far. chars counts its code points. */
export type ReplyDraft = { run: string; text: string; chars: number };

/** The draft a late joiner starts from (Conversation.activity). */
export function draftFromActivity(activity: ChatActivity | null | undefined): ReplyDraft | null {
  if (!activity?.run) return null;
  const text = activity.draft ?? "";
  return { run: activity.run, text, chars: Array.from(text).length };
}

/**
 * Applies one `delta` event to the draft. A chunk that starts where the draft
 * ends is appended; one that repeats text already there adds only what is new;
 * one that starts past the end (a chunk was missed) leaves the draft as it is
 * and asks for a refetch, after which the draft continues from activity.draft.
 * A delta of another run starts that run's draft.
 */
export function applyDelta(draft: ReplyDraft | null, event: ChatDelta): { draft: ReplyDraft | null; refetch: boolean } {
  const { run, offset, text } = event.document;
  const current = draft && draft.run === run ? draft : { run, text: "", chars: 0 };
  if (!Number.isInteger(offset) || offset < 0) return { draft, refetch: true };
  if (offset > current.chars) return { draft: draft && draft.run === run ? draft : null, refetch: true };
  const chunk = Array.from(text);
  const fresh = chunk.slice(current.chars - offset);
  if (fresh.length === 0) return { draft: current, refetch: false };
  return { draft: { run, text: current.text + fresh.join(""), chars: current.chars + fresh.length }, refetch: false };
}

// ---------------------------------------------------------------------------
// Question cards (phase 4, Q-4.3): the agent asks the person and its run waits
// for the answer. Wire shapes mirror apps/api/internal/features/chat/question.go.

/** One question of a card. choices null is an open question; recommended is the
 * index of the choice the agent recommends. Every question also takes a typed
 * answer of the person's own ("Other"). */
export type QuestionItem = {
  qid: string;
  question: string;
  choices: string[] | null;
  recommended: number | null;
  multiSelect: boolean;
};

/** Conversation.question: the card the live run waits on, `{}` when none waits.
 * The row stays `running` while it waits. Times are RFC 3339. */
export type ChatQuestion = {
  requestId?: string;
  run?: string;
  questions?: QuestionItem[];
  askedAt?: string;
  expiresAt?: string;
};

/** An answer: a choice or typed text (a string), the picks of a multi-select
 * question (a list, at most one typed item), or null to skip the question. */
export type QuestionAnswer = string | string[] | null;

/** How a card's wait ended. submitted, cancelled (Skip), timed_out and
 * undelivered come from the worker; stopped is Stop, or a run that failed or was
 * lost while it waited. */
export type QuestionOutcome = "submitted" | "cancelled" | "timed_out" | "undelivered" | "stopped";

/** A `question` message's card (Message.question) once its wait ended. */
export type AnsweredQuestion = {
  requestId: string;
  questions: QuestionItem[];
  answers: Record<string, QuestionAnswer>;
  outcome: QuestionOutcome;
};

/** POST /chats/:id/answer. 200 with the row; 409 when the card no longer waits
 * (QUESTION_CLOSED); 400 for an unknown qid or an answer the question cannot
 * take; 404 for another account's chat. A message sent (POST /messages) or
 * steered while a card waits answers every question with its text instead. */
export type AnswerQuestionInput = {
  requestId: string;
  answers?: Record<string, QuestionAnswer>;
  /** Skip: end the wait without answers. */
  skip?: boolean;
};

export const QUESTION_LIMITS = { questions: 5, choices: 4, answerChars: 2000 } as const;

/** The status word of a chat whose run waits on a card (chat header, list, sidebar). */
export const QUESTION_STATUS_WORD = "Needs your answer";
/** The push body Go sends once per card. */
export const QUESTION_PUSH = "Timely has a question.";
/** The 409 message of a stale answer. */
export const QUESTION_CLOSED = "This question was already closed";

export type QuestionCardState = "waiting" | "answered" | "skipped" | "expired" | "stopped";

/** Card titles, the same on web, desktop and phone. */
export const QUESTION_CARD_TITLES: Record<QuestionCardState, string> = {
  waiting: "Timely needs an answer",
  answered: "Answered",
  skipped: "Skipped",
  expired: "Not answered in time",
  stopped: "Stopped before you answered",
};

/** Whether the chat's live run waits on a card the person can answer now. */
export function questionWaiting(row: { status?: string; question?: ChatQuestion | null } | null | undefined): boolean {
  return row?.status === "running" && !!row.question?.requestId && (row.question.questions?.length ?? 0) > 0;
}

/** The status word for a chat waiting on a card, or null (the apps' own word applies). */
export function questionStatusWord(row: { status?: string; question?: ChatQuestion | null } | null | undefined): string | null {
  return questionWaiting(row) ? QUESTION_STATUS_WORD : null;
}

/** The state a `question` message's card shows. */
export function questionCardState(outcome: QuestionOutcome | string | null | undefined): QuestionCardState {
  switch (outcome) {
    case "submitted":
      return "answered";
    case "cancelled":
      return "skipped";
    case "timed_out":
    case "undelivered":
      return "expired";
    case "stopped":
      return "stopped";
    default:
      return "waiting";
  }
}

/** Whole seconds left before the card times out (0 once it passed), or null
 * without an expiry. */
export function questionSecondsLeft(question: ChatQuestion | null | undefined, now: Date | number = Date.now()): number | null {
  const expires = question?.expiresAt ? Date.parse(question.expiresAt) : NaN;
  if (!Number.isFinite(expires)) return null;
  const at = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.ceil((expires - at) / 1000));
}

/** "9 min left", "45 s left", or "" once it passed (the card then waits for the worker to close it).
 * Minutes round down: the label never promises more time than is left. */
export function questionTimeLeft(question: ChatQuestion | null | undefined, now: Date | number = Date.now()): string {
  const left = questionSecondsLeft(question, now);
  if (left === null || left <= 0) return "";
  return left >= 60 ? `${Math.floor(left / 60)} min left` : `${left} s left`;
}

/** The answers to send, cleaned the way the server takes them: text trimmed,
 * empty answers and lists skipped (null), repeated picks dropped. */
export function cleanAnswers(answers: Record<string, QuestionAnswer | undefined>): Record<string, QuestionAnswer> {
  const out: Record<string, QuestionAnswer> = {};
  for (const [qid, value] of Object.entries(answers)) {
    if (Array.isArray(value)) {
      const picked = [...new Set(value.map((v) => v.trim()).filter(Boolean))];
      out[qid] = picked.length ? picked : null;
    } else if (typeof value === "string") {
      const text = value.trim();
      out[qid] = text ? text : null;
    } else {
      out[qid] = null;
    }
  }
  return out;
}

/** Why the server would refuse these answers (400), or null. Mirrors Go's
 * validAnswers: a known qid; a list only for a multi-select question with
 * choices, every item one of them except one typed item; text at most 2,000
 * characters. */
export function answerProblem(questions: QuestionItem[], answers: Record<string, QuestionAnswer>): string | null {
  for (const [qid, value] of Object.entries(answers)) {
    const item = questions.find((q) => q.qid === qid);
    if (!item) return `This card has no question "${qid}"`;
    if (value === null) continue;
    if (typeof value === "string") {
      if (Array.from(value.trim()).length > QUESTION_LIMITS.answerChars) return "An answer can be at most 2,000 characters";
      continue;
    }
    if (!item.multiSelect || !item.choices?.length) return "Pick one answer to this question";
    const typed = value.filter((v) => !item.choices!.includes(v.trim()));
    if (typed.length > 1 || typed.some((v) => Array.from(v.trim()).length > QUESTION_LIMITS.answerChars)) {
      return "Pick from this question's choices";
    }
  }
  return null;
}

/** One line per question of an answered card, for its collapsed summary. */
export function answerSummary(card: AnsweredQuestion): { question: string; answer: string }[] {
  return card.questions.map((q) => {
    const value = card.answers?.[q.qid];
    const answer = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "—";
    return { question: q.question, answer };
  });
}

// ---------------------------------------------------------------- host cards (phase 5)

/** What a host card is about (gate.verdict card.kind). */
export type HostCardKind = "terminal" | "file" | "code" | "browser" | "mcp" | "mcp_server";

/** A host card as Go builds it from the call's real arguments. Command, path
 * and URL are plain text: never draw them as links (a tainted model may have
 * written them). */
export type HostCard = {
  kind: HostCardKind;
  title: string;
  command?: string;
  path?: string;
  url?: string;
  cwd?: string;
  server?: string;
  envNames?: string[];
  /** Why it asks: Go's reason (the critical-list reason, the mode, Ask me first). */
  reason: string;
  /** The critical-list item (agent/permission.go), when it is one. */
  criticalItem?: number;
  /** Whether "Allow for this chat" is offered. */
  grantable: boolean;
};

/** One "Allow for this chat" grant (DELETE /chats/:id/host-grants/:key removes it). */
export type HostGrant = { kind: string; key: string; match: string; label: string; at?: string };

export type HostPhase = "live" | "parked";

/** The host card a chat waits on (`hostRequest`, status `host_approval`); `{}` when none. */
export type HostRequest = {
  requestId?: string;
  run?: string;
  phase?: HostPhase;
  tool?: string;
  toolCallId?: string;
  argsHash?: string;
  card?: HostCard;
  askedAt?: string;
  /** Until when the run waits live (Run once continues the same reply). */
  liveUntil?: string;
  /** Until when a parked card waits (then "Expired, not run"). */
  expiresAt?: string;
  grant?: HostGrant;
};

/** The device an answer or a step-up comes from. The server sets `shell` for
 * the desktop window; a phone sends `unlocked` after device unlock. */
export type HostDevice = { kind: "desktop" | "web" | "phone"; name?: string; unlocked?: boolean; shell?: boolean };

/** The step-up that turned Full Access on; `{}` when none (Full then acts as Auto). */
export type FullAccessRecord = { at?: string; device?: HostDevice };

export type HostChoice = "once" | "chat" | "deny";

/** POST /chats/:id/host-approval. */
export type HostAnswerInput = { revision?: number; requestId: string; choice: HostChoice; device?: HostDevice };

/** How a host card closed (a "host" message's `host.outcome`). `approved` is
 * the interim state of an answered card whose call has not run yet: only the
 * worker's report that the call ran makes it `ran` (or `allowed` after Allow
 * for this chat), and a Stop or a turn that ends without the call makes it
 * `notrun`. */
export type HostOutcome =
  | "ran"
  | "allowed"
  | "denied"
  | "expired"
  | "stopped"
  | "approved"
  | "notrun";

/** A "host" message: a closed host card, or (auto) a call that ran without
 * one and left a checkpoint. */
export type ClosedHost = {
  requestId?: string;
  toolCallId?: string;
  tool: string;
  card?: HostCard;
  outcome: HostOutcome;
  device?: HostDevice;
  /** What the person answered (`once`, `chat`) on a card that asked. */
  choice?: "once" | "chat";
  argsHash?: string;
  auto?: boolean;
  checkpoint?: string;
  checkpointDir?: string;
  undoneAt?: string;
};

export type HostCardState = HostPhase | HostOutcome;

/** The buttons, in the order drawn. */
export const HOST_BUTTONS: Record<HostChoice, string> = { once: "Run once", chat: "Allow for this chat", deny: "Deny" };

/** The card's state words, open and closed (contract 8). */
export const HOST_CARD_STATE_WORDS: Record<HostCardState, string> = {
  live: "Needs your OK",
  parked: "Waiting for your OK",
  ran: "Ran",
  allowed: "Allowed for this chat",
  denied: "Denied",
  expired: "Expired, not run",
  stopped: "Stopped before you answered",
  approved: "Approved, waiting to run",
  notrun: "Approved, did not run",
};

/** The chat's status word while a host card waits (header, list, sidebar, Activity). */
export const HOST_STATUS_WORDS: Record<HostPhase, string> = { live: "Needs your OK", parked: "Waiting for your OK" };

/** What the run's activity box says while a host card is on screen: the card
 * carries "Needs your OK", so the box does not repeat it. */
export const HOST_PAUSED_LINE = "Paused until you answer";

/** The activity line and closed card action. */
export const HOST_UNDO = "Undo this change";

/** The answers the server refuses (409 and 403), as it words them. */
export const HOST_ERRORS = {
  answered: "This card was already answered",
  stale: "This card changed. Read the new one first.",
  live: "Answer the card above first, or stop this reply",
  phoneLocked: "Unlock your phone to approve this",
  desktopOnly: "Approve this card in the desktop app",
  fullAccess: "Turn on Full Access from the desktop app",
  undoGone: "This change can't be undone any more",
} as const;

/** How long a parked card may wait (minutes). */
export const HOST_TIMEOUT_LIMITS = { min: 10, max: 60, default: 60 } as const;

/** A card's title by kind, as Go words it (Go sends the title too). */
export function hostCardTitle(card: Pick<HostCard, "kind" | "server">): string {
  switch (card.kind) {
    case "terminal":
      return "Run this command?";
    case "file":
      return "Change this file?";
    case "code":
      return "Run this code?";
    case "browser":
      return "Use your browser?";
    case "mcp":
      return `Use ${card.server || "this MCP server"}?`;
    case "mcp_server":
      return "Add this MCP server?";
  }
}

/** The one line a card is about: its command, path, URL or server. */
export function hostSubject(card: HostCard | null | undefined): string {
  if (!card) return "";
  return (card.command || card.path || card.url || card.server || "").trim();
}

/** Whether the chat waits on a host card. */
export function hostWaiting(row: { status?: string; hostRequest?: HostRequest | null } | null | undefined): boolean {
  return row?.status === "host_approval" && !!row.hostRequest?.requestId;
}

/** The status word for a chat waiting on a host card, or null. */
export function hostStatusWord(row: { status?: string; hostRequest?: HostRequest | null } | null | undefined): string | null {
  if (!hostWaiting(row)) return null;
  return HOST_STATUS_WORDS[row!.hostRequest!.phase === "parked" ? "parked" : "live"];
}

/** The status word for a chat waiting on any card (question or host), or null. */
export function cardStatusWord(
  row: { status?: string; question?: ChatQuestion | null; hostRequest?: HostRequest | null } | null | undefined,
): string | null {
  return questionStatusWord(row) ?? hostStatusWord(row);
}

/** The state an open card or a closed one shows. */
export function hostCardState(card: HostRequest | ClosedHost | null | undefined): HostCardState {
  if (card && "outcome" in card && card.outcome) {
    return (["ran", "allowed", "denied", "expired", "stopped", "approved", "notrun"] as const).includes(card.outcome) ? card.outcome : "stopped";
  }
  return (card as HostRequest | null | undefined)?.phase === "parked" ? "parked" : "live";
}

/** The choices an open card offers, in order: Allow for this chat only when grantable. */
export function hostChoices(request: HostRequest | null | undefined): HostChoice[] {
  return request?.card?.grantable ? ["once", "chat", "deny"] : ["once", "deny"];
}

/** Whether the phone must unlock before sending this choice (Deny never needs it). */
export function hostNeedsUnlock(choice: HostChoice, device: HostDevice["kind"]): boolean {
  return device === "phone" && choice !== "deny";
}

/** Whole seconds until the live wait ends (live) or the card expires (parked),
 * 0 once it passed, or null without a time. */
export function hostSecondsLeft(request: HostRequest | null | undefined, now: Date | number = Date.now()): number | null {
  const until = request?.phase === "parked" ? request?.expiresAt : request?.liveUntil;
  const at = until ? Date.parse(until) : NaN;
  if (!Number.isFinite(at)) return null;
  const t = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.ceil((at - t) / 1000));
}

/** What the clock on an open card counts down, said as what happens: a live
 * card "Pauses in 9 min" (it then waits parked, still answerable for up to an
 * hour), a parked one "Closes in 45 min". "" once it passed. Minutes round
 * down. */
export function hostTimeLeft(request: HostRequest | null | undefined, now: Date | number = Date.now()): string {
  const left = hostSecondsLeft(request, now);
  if (left === null || left <= 0) return "";
  const lead = request?.phase === "parked" ? "Closes in" : "Pauses in";
  return left >= 60 ? `${lead} ${Math.floor(left / 60)} min` : `${lead} ${left} s`;
}

/** Whether "Undo this change" is offered for a closed card or a change. */
export function hostCanUndo(closed: ClosedHost | null | undefined): boolean {
  return !!closed?.checkpoint && !closed.undoneAt;
}

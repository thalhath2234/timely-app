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

/** GET /agent/chat-settings. */
export type AgentChatSettings = {
  engine: AccountEngine;
  chatPermission: PermissionMode;
  botPermission: PermissionMode;
  fullAccessAllowedOn: FullAccessAllowedOn;
  /** Whether the agent engine can run for this account now, and why not. */
  engineAvailable: boolean;
  engineReason: string;
};

/** The fields of PATCH /agent/chat-settings. */
export type AgentChatSettingsPatch = Partial<Pick<AgentChatSettings, "engine" | "chatPermission" | "botPermission" | "fullAccessAllowedOn">>;

/** The account defaults before anything is saved (Q-2.2, Q-P1). */
export const DEFAULT_CHAT_SETTINGS: Omit<AgentChatSettings, "engineAvailable" | "engineReason"> = {
  engine: "classic",
  chatPermission: "supervised",
  botPermission: "auto",
  fullAccessAllowedOn: "desktop",
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

/** Mode names and descriptions, the same on web, desktop and phone. In phase 2
 * Full Access works like Auto for Timely data, so its copy never promises that
 * nothing asks. */
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
    description: "Does the everyday work on its own. Asks before deleting, sending your data out, paying, installing or changing settings.",
    short: "Asks only before deleting, sending your data out, paying, installing or changing settings",
    icon: "shield",
    tone: "indigo",
  },
  full: {
    name: "Full Access",
    description: "Works like Auto for now: the changes Auto asks about still ask. Everything is logged, and changes that can be undone show Undo.",
    short: "Works like Auto for now. Turn on from the desktop app",
    icon: "bolt",
    tone: "amber",
  },
};

/** Under the picker: the choice is the chat's own. */
export const CHAT_PERMISSION_NOTE = "Only this chat. New chats start on your default.";

/** The phone shows Full Access disabled with this line (phase 2: no step-up yet). */
export const FULL_ACCESS_PHONE_NOTE = "Turn on from the desktop app";

/** The one-time confirmation before turning Full Access on (web and desktop). */
export const FULL_ACCESS_CONFIRM =
  "Full Access works like Auto for now: deleting, sending your data out, paying, installing and settings changes still ask. Turn it on for this chat?";

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
  { item: 6, title: "Changes after reading outside pages", detail: "A page could have told it what to do" },
];

export const ENGINE_COPY: Record<AccountEngine, { name: string; description: string }> = {
  classic: { name: "Classic", description: "Timely’s assistant as it works today." },
  agent: { name: "New", description: "The new agent engine: replies stream in as they are written." },
};

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

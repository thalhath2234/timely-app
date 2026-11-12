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

/** One line of a live agent run's activity: a tool it runs or a status it reports. */
export type ActivityLine = {
  id: string;
  kind: "tool" | "status";
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

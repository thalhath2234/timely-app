/**
 * The phone's rules for chat on the agent engine (plan phase 2): the
 * permission chip and picker, the reply streamed while a run is live, steer,
 * Undo of a change applied on its own, and the engine label. Pure functions
 * only, so `make test-mobile-assistant` runs them under Node.
 */
import {
  PERMISSION_COPY,
  PERMISSION_MODES,
  FULL_ACCESS_PHONE_NOTE,
  ENGINE_COPY,
  USE_CLASSIC_ACTION,
  applyDelta,
  draftFromActivity,
  type ChatActivity,
  type ChatDelta,
  type PermissionMode,
  type ReplyDraft,
} from "@timely/contract/agentChat";
import type { Chat, ChatMessage, ChatStep } from "./types";

/** A chat's mode, Supervised for rows written before modes existed. */
export function chatPermission(value: string | undefined | null): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value ?? "") ? (value as PermissionMode) : "supervised";
}

export type PermissionChip = {
  mode: PermissionMode;
  label: string;
  icon: "eye" | "shield" | "bolt";
  tone: "green" | "indigo" | "amber";
  /** The chip's screen-reader name. */
  accessibilityLabel: string;
};

/** The header chip for a chat's mode, as drawn: green eye, indigo shield, amber bolt. */
export function permissionChip(value: string | undefined | null): PermissionChip {
  const mode = chatPermission(value);
  const copy = PERMISSION_COPY[mode];
  return { mode, label: copy.name, icon: copy.icon, tone: copy.tone, accessibilityLabel: `Permission: ${copy.name}. Change` };
}

export type PermissionOption = {
  mode: PermissionMode;
  name: string;
  /** The phone sheet's line under the name. */
  line: string;
  selected: boolean;
  /** Shown but not offered on the phone. */
  disabled: boolean;
};

/**
 * Full Access can't be turned on from the phone in phase 2: it needs the
 * desktop app's confirmation (device unlock arrives in phase 5). A chat
 * already on Full Access shows it chosen and can still move to a stricter mode.
 */
export function fullAccessDisabledOnPhone(): boolean {
  return true;
}

/** The three rows of the phone's permission picker. */
export function permissionOptions(current: string | undefined | null): PermissionOption[] {
  const selected = chatPermission(current);
  return PERMISSION_MODES.map((mode) => {
    const copy = PERMISSION_COPY[mode];
    const lockedFull = mode === "full" && fullAccessDisabledOnPhone();
    return {
      mode,
      name: copy.name,
      line: lockedFull && !copy.short.includes(FULL_ACCESS_PHONE_NOTE) ? `${copy.short}. ${FULL_ACCESS_PHONE_NOTE}` : copy.short,
      selected: mode === selected,
      // The chosen row is never "disabled": it is what the chat runs on.
      disabled: lockedFull && mode !== selected,
    };
  });
}

/** Whether picking `next` on the phone sends anything. */
export function canPickPermission(current: string | undefined | null, next: PermissionMode): boolean {
  if (chatPermission(current) === next) return false;
  return !(next === "full" && fullAccessDisabledOnPhone());
}

/** Busy: queued or running (chatMeta.isBusy, kept here so tests need no icons). */
function busy(status?: string) {
  return status === "queued" || status === "running";
}

/**
 * The engine this chat's next run would use: its own choice, else the
 * account's. Sensitive chats and the photo phases always run classic.
 */
export function effectiveEngine(chat: Pick<Chat, "engine" | "sensitive"> | undefined, accountEngine: string | undefined): "classic" | "agent" {
  if (chat?.sensitive) return "classic";
  const own = chat?.engine ?? "";
  if (own === "classic" || own === "agent") return own;
  return accountEngine === "agent" ? "agent" : "classic";
}

/** An agent run is thinking or writing in this chat now (not applying an approved plan). */
export function agentRunLive(chat: Pick<Chat, "status" | "phase" | "runEngine" | "activity"> | undefined): boolean {
  if (!chat || !busy(chat.status) || chat.phase === "apply") return false;
  return chat.runEngine === "agent" || Boolean(chat.activity?.run);
}

/**
 * Follow /chats/watch for this chat: while a run may be streaming its reply
 * (the run is live, or a queued run will start on the agent engine).
 */
export function wantsReplyStream(
  chat: Pick<Chat, "status" | "phase" | "runEngine" | "activity" | "engine" | "sensitive"> | undefined,
  accountEngine: string | undefined,
): boolean {
  if (!chat || !busy(chat.status) || chat.phase === "apply") return false;
  return agentRunLive(chat) || (chat.status === "queued" && effectiveEngine(chat, accountEngine) === "agent");
}

/**
 * What the composer's send does: "steer" adds the text to the live agent run
 * (POST /chats/:id/steer), "send" starts a turn, "none" waits (a classic run
 * or an apply is going; Stop is the one action).
 */
export function composerMode(chat: Pick<Chat, "status" | "phase" | "runEngine" | "activity"> | undefined): "send" | "steer" | "none" {
  if (!chat || !busy(chat.status)) return "send";
  // Steer needs the run to have started: the server answers 409 before.
  return chat.status === "running" && agentRunLive(chat) ? "steer" : "none";
}

/** The reply draft after a refetch: activity.draft when it knows more than the stream did, none once the run ended. */
export function mergeActivityDraft(current: ReplyDraft | null, activity: ChatActivity | null | undefined): ReplyDraft | null {
  const saved = draftFromActivity(activity);
  if (!saved) return null;
  if (!current || current.run !== saved.run) return saved;
  return saved.chars > current.chars ? saved : current;
}

/** One `delta` event for the open chat; refetch says a chunk was missed. Other chats' events change nothing. */
export function onDelta(chatId: string | null, current: ReplyDraft | null, event: ChatDelta): { draft: ReplyDraft | null; refetch: boolean } {
  if (!chatId || event.id !== chatId || event.kind !== "chat") return { draft: current, refetch: false };
  return applyDelta(current, event);
}

/** The streamed text to draw now: only while the chat's run is live and the draft is that run's. */
export function visibleDraft(chat: Pick<Chat, "status" | "phase" | "runEngine" | "activity"> | undefined, draft: ReplyDraft | null): string {
  if (!draft || !agentRunLive(chat)) return "";
  const run = chat?.activity?.run;
  if (run && run !== draft.run) return "";
  return draft.text;
}

/** "Classic" / "New engine" beside the model, when the chat is not simply on the account's Classic. */
export function engineLabel(chat: Pick<Chat, "engine" | "runEngine"> | undefined): string {
  if (!chat) return "";
  const engine = chat.runEngine || chat.engine || "";
  if (engine === "agent") return `${ENGINE_COPY.agent.name} engine`;
  if (chat.engine === "classic") return `${ENGINE_COPY.classic.name} engine`;
  return "";
}

/** The run failed because the agent engine could not start: offer Use classic. */
export function offersUseClassic(chat: Pick<Chat, "errorAction" | "status"> | undefined): boolean {
  return chat?.errorAction === USE_CLASSIC_ACTION && (chat.status === "failed" || chat.status === "stopped");
}

export type AutoAppliedState = "applying" | "applied" | "undo" | "undoLater" | "undoing" | "undoFailed" | "undone" | "none";

/**
 * What an auto-applied proposal's card shows, as the server will answer:
 * - "applying" while its own changes apply (the newest proposal only);
 * - "applied" when not every change went in (the server keeps no Undo then);
 * - "undo" when every change went in and the chat is idle;
 * - "undoLater" the same while another run, apply or review is going, when
 *   the server refuses Undo;
 * - "undoing" / "undoFailed" while its undo applies or after it stopped short
 *   (the server marks it undone as soon as Undo is asked);
 * - "undone" once the undo went through.
 */
export function autoAppliedState(
  message: ChatMessage,
  chat: Pick<Chat, "status" | "plan" | "messages">,
): AutoAppliedState {
  if (!message.proposal || !message.autoApplied) return "none";
  const newest = latestProposal(chat.messages) === message;
  const plan = chat.plan ?? [];
  if (message.undoneAt) {
    const undoPlan = newest && plan.some((step) => step.undo);
    if (undoPlan && busy(chat.status)) return "undoing";
    if (undoPlan && (chat.status === "failed" || chat.status === "stopped")) return "undoFailed";
    return "undone";
  }
  const steps = appliedSteps(chat, message);
  const allDone = steps.length > 0 && steps.every((step) => step.status === "done");
  if (newest && busy(chat.status) && !allDone) return "applying";
  if (!allDone) return "applied";
  if (busy(chat.status) || chat.status === "approval") return "undoLater";
  return "undo";
}

/** True when one frame of /chats/watch is a usable delta event. */
export function isChatDelta(event: { type?: string; id?: string; kind?: string; document?: unknown }): event is ChatDelta {
  const doc = event.document as { run?: unknown; offset?: unknown; text?: unknown } | undefined;
  return (
    event.type === "delta" &&
    typeof event.id === "string" &&
    !!doc &&
    typeof doc.run === "string" &&
    typeof doc.offset === "number" &&
    typeof doc.text === "string"
  );
}

/** The chat's newest proposal summary message. */
export function latestProposal(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].proposal) return messages[i];
  return undefined;
}

/**
 * The archives an auto-applied card already shows (its applied steps after
 * Undo or a later proposal): the thread skips them, as the web does.
 */
export function autoCardArchives(chat: Pick<Chat, "messages" | "plan">): Set<string> {
  const out = new Set<string>();
  const plan = chat.plan ?? [];
  const newest = latestProposal(chat.messages);
  chat.messages.forEach((message, index) => {
    if (!message.proposal || !message.autoApplied) return;
    if (!message.undoneAt && newest === message && plan.length && !plan.every((step) => step.undo)) return;
    for (const next of chat.messages.slice(index + 1)) {
      if (next.proposal) return;
      if (next.kind === "archive" && next.steps?.length) {
        out.add(next.id);
        return;
      }
    }
  });
  return out;
}

/**
 * The steps an auto-applied proposal applied (undo.go appliedPlan): the live
 * plan while it is the newest proposal and not undone, else the archive that
 * followed it.
 */
export function appliedSteps(chat: Pick<Chat, "messages" | "plan">, message: ChatMessage): ChatStep[] {
  const index = chat.messages.indexOf(message);
  if (index < 0) return [];
  const plan = chat.plan ?? [];
  if (!message.undoneAt && latestProposal(chat.messages) === message && plan.length && !plan.every((step) => step.undo))
    return plan;
  for (const next of chat.messages.slice(index + 1)) {
    if (next.proposal) return [];
    if (next.kind === "archive" && next.steps?.length) return next.steps;
  }
  return [];
}

/** The live plan is an Undo's: every step puts something back. */
export function isUndoPlan(plan: ChatStep[] | undefined): boolean {
  return !!plan?.length && plan.every((step) => step.undo);
}

/**
 * The bottom plan card says nothing the auto-applied card above does not:
 * hidden once the newest proposal applied on its own and finished.
 */
export function planSummaryHidden(chat: Pick<Chat, "messages" | "plan" | "status">): boolean {
  const latest = latestProposal(chat.messages);
  if (!latest?.autoApplied || latest.undoneAt || isUndoPlan(chat.plan)) return false;
  return chat.status === "idle" && (chat.plan ?? []).every((step) => step.status === "done");
}

/** The line under the message box for the chat's mode. */
export function permissionHint(value: string | undefined | null): string {
  return chatPermission(value) === "supervised"
    ? "Every change waits for your review."
    : "Changes happen on their own, with Undo. Deleting and settings changes ask first.";
}

"use client";
import { useState } from "react";
import { Check, ChevronRight, Undo2, X } from "lucide-react";
import { planGroups } from "@timely/contract/changeReview";
import type { ActivityLine, ReplyDraft } from "@timely/contract/agentChat";
import TimelyLogo, {
  LogoSpinner,
  SPINNER_LOOP_SECONDS,
} from "@/app/_components/_ui/timelyLogo";
import type { Chat, ChatMessage, ChatStep } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import ChangeCards from "./changeCards";
import ChatText from "./chatText";
import { isBusy } from "./chatMeta";
import { modeName } from "./permissionPicker";

/**
 * What a live agent run shows (plan 5.5b, Q-2.5): the lines of what it is
 * doing, the reply as it is written, and the "Ran on its own" card with
 * Undo for a proposal Auto or Full Access applied without asking.
 */

const eyebrow =
  "text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted-foreground";

/** How many of a run's newest lines show; earlier ones fold into a count. */
const SHOWN_LINES = 6;

function LineIcon({ state }: { state: ActivityLine["state"] }) {
  if (state === "running")
    return <LogoSpinner size={14} tone="mono" label="Running" />;
  if (state === "failed")
    return <X aria-hidden className="size-3.5 shrink-0 text-destructive" />;
  return <Check aria-hidden className="size-3.5 shrink-0 text-success-text" />;
}

/** The busy card of an agent run: what it is doing, line by line. */
export function RunActivity({ chat }: { chat: Chat }) {
  const lines = chat.activity?.lines ?? [];
  const shown = lines.slice(-SHOWN_LINES);
  const hidden = lines.length - shown.length;
  return (
    <section
      role="status"
      aria-label="What Timely is doing"
      className="mt-5 rounded-xl border border-border bg-card px-3.5 py-3 text-sm"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <TimelyLogo
            size={16}
            animated
            duration={SPINNER_LOOP_SECONDS}
            tone="mono"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Working</p>
          <p className="text-xs text-muted-foreground">
            This keeps running on the server. You can leave and come back, or
            reply to steer it.
          </p>
        </div>
      </div>
      {shown.length > 0 && (
        <ol className="mt-2.5 flex flex-col gap-1.5 border-t border-border pt-2.5">
          {hidden > 0 && (
            <li className="pl-[22px] text-xs text-muted-foreground">
              {hidden} earlier {hidden === 1 ? "step" : "steps"}
            </li>
          )}
          {shown.map((line) => (
            <li
              key={line.id}
              className={cn(
                "flex min-w-0 items-center gap-2 text-[13px] leading-[18px]",
                line.state === "failed"
                  ? "text-destructive"
                  : line.kind === "status"
                    ? "text-muted-foreground"
                    : "text-foreground",
              )}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <LineIcon state={line.state} />
              </span>
              <span className="min-w-0 truncate">{line.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The reply a live run is writing, as a Timely message that grows. */
export function LiveReply({ draft }: { draft: ReplyDraft }) {
  return (
    <div className="mt-5 flex gap-3" aria-live="off" data-testid="live-reply">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
        <TimelyLogo size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-semibold">Timely</span>
        {/* A caret after the last line while the reply is still coming. */}
        <div className="mt-1 [&>div>*:last-child]:after:ml-0.5 [&>div>*:last-child]:after:inline-block [&>div>*:last-child]:after:h-[1em] [&>div>*:last-child]:after:w-0.5 [&>div>*:last-child]:after:translate-y-0.5 [&>div>*:last-child]:after:animate-pulse [&>div>*:last-child]:after:rounded-full [&>div>*:last-child]:after:bg-primary [&>div>*:last-child]:after:content-['']">
          <ChatText text={draft.text} />
        </div>
      </div>
    </div>
  );
}

/** The plan a proposal message applied: the live plan for the newest
 * proposal, else the archive that followed it (Go's appliedPlan). */
export function appliedSteps(chat: Chat, index: number): { steps: ChatStep[]; archiveId?: string } {
  const messages = chat.messages ?? [];
  const latest = messages.findLastIndex((m) => m.proposal);
  const plan = chat.plan ?? [];
  if (latest === index && plan.length && !plan.some((s) => s.undo))
    return { steps: plan };
  for (const m of messages.slice(index + 1)) {
    if (m.proposal) break;
    if (m.kind === "archive" && m.steps?.length)
      return { steps: m.steps, archiveId: m.id };
  }
  return { steps: [] };
}

/**
 * Whether the live plan belongs to an auto-applied proposal or its Undo, so
 * the "Ran on its own" card shows it instead of the review panel (which
 * still shows a failed or stopped apply, with its Try again).
 */
export function planShownByAutoCard(chat: Chat) {
  const plan = chat.plan ?? [];
  if (!plan.length || ["failed", "stopped"].includes(chat.status)) return false;
  if (plan.some((s) => s.undo)) return true;
  const latest = chat.messages?.findLast((m) => m.proposal);
  return Boolean(latest?.autoApplied);
}

/** Archives the "Ran on its own" cards already show. */
export function autoCardArchives(chat: Chat): Set<string> {
  const out = new Set<string>();
  chat.messages?.forEach((m, i) => {
    if (!m.proposal || !m.autoApplied) return;
    const { archiveId } = appliedSteps(chat, i);
    if (archiveId) out.add(archiveId);
  });
  return out;
}

/** One line per change, as the review counts them. */
function changeLines(steps: ChatStep[]) {
  return planGroups(steps).map((group) => {
    const first = steps[group.steps[0]];
    const statuses = group.steps.map((i) => steps[i]?.status);
    const state: ActivityLine["state"] = statuses.some((s) => s === "failed")
      ? "failed"
      : statuses.every((s) => s === "done")
        ? "done"
        : "running";
    const more = group.steps.length - 1;
    return {
      key: group.key,
      label: more > 0 ? `${first.summary} and ${more} more` : first.summary,
      state,
    };
  });
}

/**
 * A proposal the chat's permission mode let apply without asking, as drawn:
 * "Ran on its own · Auto", a line per change, and Undo, which queues the
 * changes that put the data back (POST /chats/:id/undo).
 */
export function AutoAppliedCard({
  chat,
  message,
  index,
  pending,
  onUndo,
}: {
  chat: Chat;
  message: ChatMessage;
  index: number;
  pending: boolean;
  onUndo?: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { steps } = appliedSteps(chat, index);
  const lines = changeLines(steps);
  const busy = isBusy(chat.status);
  const undone = Boolean(message.undoneAt);
  const undoPlan = undone && (chat.plan ?? []).some((s) => s.undo);
  const undoing = undoPlan && busy;
  const undoFailed = undoPlan && ["failed", "stopped"].includes(chat.status);
  const applied = lines.length > 0 && lines.every((l) => l.state === "done");
  const canUndo =
    !undone && applied && !busy && chat.status !== "approval" && !!onUndo;
  const mode = chat.permission === "full" ? "full" : "auto";
  const undoState = undoing
    ? "Undoing…"
    : undoFailed
      ? "Undo didn't finish"
      : undone
        ? "Undone"
        : "";
  return (
    <section
      aria-label="Ran on its own"
      data-testid="auto-applied"
      className={cn(
        "flex max-w-[86%] flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3",
        undone && "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn(eyebrow, "min-w-0 flex-1 truncate")}>
          Ran on its own · {modeName(mode)}
        </span>
        {undoState && (
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
              undoFailed
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
            )}
          >
            {undoing ? (
              <LogoSpinner size={11} tone="mono" label="Undoing" />
            ) : (
              <Undo2 aria-hidden className="size-3" />
            )}
            {undoState}
          </span>
        )}
      </div>
      {message.content && (
        <p className="text-[13px] font-medium leading-[18px]">
          {message.content}
        </p>
      )}
      {lines.map((line, i) => (
        <div
          key={line.key}
          className={cn(
            "flex min-h-[22px] min-w-0 items-center gap-2 text-[13px] leading-[18px]",
            undone && "text-muted-foreground line-through decoration-muted-foreground/50",
          )}
        >
          <span className="flex w-3.5 shrink-0 justify-center">
            <LineIcon state={line.state === "running" && !busy ? "done" : line.state} />
          </span>
          <span className="min-w-0 flex-1 truncate">{line.label}</span>
          {i === lines.length - 1 && canUndo && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onUndo?.(message.id)}
              className="-my-0.5 inline-flex h-[22px] shrink-0 cursor-pointer items-center rounded-md px-1.5 text-xs font-medium text-muted-foreground no-underline outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </div>
      ))}
      {steps.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="mt-0.5 inline-flex w-fit cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
            {open ? "Hide the changes" : "See the changes"}
          </button>
          {open && (
            <div className="pt-1.5">
              <ChangeCards steps={steps} muted />
            </div>
          )}
        </>
      )}
    </section>
  );
}

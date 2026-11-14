"use client";
import { useEffect, useId, useState } from "react";
import {
  Ban,
  Check,
  Clock,
  CodeXml,
  FilePenLine,
  Globe,
  Hourglass,
  Lock,
  Plug,
  ServerCog,
  SquareTerminal,
  TimerOff,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  HOST_UNDO,
  hostSecondsLeft,
  type ClosedHost,
  type HostApprovalRule,
  type HostCardKind,
  type HostCardState,
  type HostChoice,
  type HostRequest,
} from "@timely/contract/agentChat";
import Button from "@/app/_components/_ui/button";
import { cn } from "@/app/utils/cn";
import { timeOfDay } from "./chatMeta";
import {
  choiceAccess,
  closedHostView,
  hostCardView,
  type Surface,
} from "./hostView";

/**
 * The host card (phase 5, Q-5.1): the assistant wants to run a command,
 * change a file, use the browser or an MCP tool on this computer, and its
 * run waits. Built like the question card: a header tile, the call itself,
 * then the choices. The command, path and address are the model's own call,
 * which may have read an outside page, so they show as plain text in a
 * block: never a link, never formatted.
 */

const KIND_ICON: Record<HostCardKind, LucideIcon> = {
  terminal: SquareTerminal,
  file: FilePenLine,
  code: CodeXml,
  browser: Globe,
  mcp: Plug,
  mcp_server: ServerCog,
};

/** Re-renders every second in the last minute, else every 15 seconds. */
function useNow(request: HostRequest) {
  const [now, setNow] = useState(() => Date.now());
  const left = hostSecondsLeft(request, now);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left <= 60 ? 1000 : 15000);
    return () => clearTimeout(id);
  }, [left, now]);
  return now;
}

const eyebrow =
  "block text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted-foreground";

/** The call, as plain text. `id` lets the buttons name it for a screen reader. */
function Subject({
  id,
  label,
  text,
  cwd,
  page,
  detailLabel,
  detail,
}: {
  id: string;
  label: string;
  text: string;
  cwd?: string;
  /** What a script with no address acts on ("the page that is open"). */
  page?: string;
  /** A second block (the browser's script) under the first. */
  detailLabel?: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <span id={`${id}-label`} className={eyebrow}>
        {label}
      </span>
      {/* Never clipped: the end of a long command is often the dangerous part
          (Go already cuts at 4,000 characters). */}
      <pre
        id={id}
        data-testid="host-subject"
        role="region"
        aria-labelledby={`${id}-label`}
        tabIndex={0}
        className="mt-1 whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-[18px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {text}
      </pre>
      {detail && (
        <>
          <span id={`${id}-detail-label`} className={cn(eyebrow, "mt-2")}>
            {detailLabel}
          </span>
          <pre
            data-testid="host-detail"
            role="region"
            aria-labelledby={`${id}-detail-label`}
            tabIndex={0}
            className="mt-1 whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-[18px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {detail}
          </pre>
        </>
      )}
      {page && (
        <p
          data-testid="host-page"
          className="mt-1.5 text-xs leading-4 text-muted-foreground"
        >
          {page}
        </p>
      )}
      {cwd && (
        <p className="mt-1.5 flex min-w-0 gap-1.5 text-xs leading-4 text-muted-foreground">
          <span className="shrink-0">In</span>
          <span
            data-testid="host-cwd"
            className="min-w-0 break-all font-mono text-foreground"
          >
            {cwd}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The card the chat waits on. Run once and Allow for this chat only work
 * where the account's rule lets this device answer; Deny always does.
 */
export default function HostCard({
  request,
  surface,
  rule,
  sending,
  error,
  onAnswer,
}: {
  request: HostRequest;
  surface: Surface;
  rule?: HostApprovalRule;
  /** An answer is on its way. */
  sending: HostChoice | null;
  error?: string;
  onAnswer: (choice: HostChoice) => void;
}) {
  const group = useId();
  const titleId = `${group}-title`;
  const subjectId = `${group}-subject`;
  const now = useNow(request);
  const view = hostCardView(request, now);
  const Icon = KIND_ICON[view.kind];
  const busy = sending !== null;
  const access = choiceAccess(view.choices, surface, rule);
  const blocked = access.find((a) => !a.enabled)?.why ?? "";
  const labels = {
    once: "Run once",
    chat: "Allow for this chat",
    deny: "Deny",
  } as const;
  const order = (["once", "chat", "deny"] as const).filter((c) =>
    view.choices.includes(c),
  );
  return (
    <section
      aria-labelledby={titleId}
      data-testid="host-card"
      data-state={busy ? "sending" : view.state}
      data-kind={view.kind}
      className={cn(
        "max-w-full overflow-hidden rounded-xl border bg-card sm:max-w-[86%]",
        view.state === "live" ? "border-warning/50" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2 px-3.5 py-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[10px]",
            view.state === "live"
              ? "bg-warning/15 text-warning-text"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1 basis-44">
          <span
            id={titleId}
            className="block text-[13px] font-semibold leading-[18px]"
          >
            {view.title}
          </span>
          <span className="block text-xs leading-4 text-muted-foreground">
            {view.lead}
          </span>
        </span>
        {/* Below sm the pills drop to their own row under the title, so the title and
            lead keep the card's width instead of being squeezed beside them. */}
        <span className="flex shrink-0 flex-row flex-wrap items-center gap-1 max-sm:basis-full max-sm:pl-[42px] sm:flex-col sm:items-end">
          <span
            data-testid="host-state"
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
              view.state === "live"
                ? "bg-warning/15 text-warning-text"
                : "bg-muted text-muted-foreground",
            )}
          >
            {view.state === "parked" && (
              <Hourglass aria-hidden className="size-3" />
            )}
            {view.stateWord}
          </span>
          {(view.timeLeft || view.timeUp) && (
            <span
              data-testid="host-time-left"
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium tabular-nums",
                view.soon
                  ? "bg-warning/15 text-warning-text"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Clock aria-hidden className="size-3" />
              {view.timeUp
                ? view.state === "parked"
                  ? "Time is up"
                  : "Pausing"
                : view.timeLeft}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border px-3.5 py-3">
        <Subject
          id={subjectId}
          label={view.subjectLabel}
          text={view.subject}
          cwd={view.cwd}
          page={view.page}
          detailLabel={view.detailLabel}
          detail={view.detail}
        />
        {view.envNames.length > 0 && (
          <p className="text-xs leading-4 text-muted-foreground">
            Starts with these variables:{" "}
            <span className="font-mono text-foreground">
              {view.envNames.join(", ")}
            </span>
          </p>
        )}
        {view.reason && (
          <p
            data-testid="host-reason"
            className="whitespace-pre-wrap break-words text-xs leading-4 text-muted-foreground"
          >
            {view.reason}
          </p>
        )}
        {view.critical && (
          <p
            data-testid="host-critical"
            className="flex items-start gap-1.5 text-xs font-medium leading-4 text-warning-text"
          >
            <Lock aria-hidden className="mt-px size-3 shrink-0" />
            {view.critical}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border px-3.5 py-2.5">
        <span
          aria-live="polite"
          className="min-w-0 flex-1 basis-40 text-xs leading-4 text-muted-foreground"
        >
          {busy
            ? sending === "deny"
              ? "Telling the assistant no…"
              : "Sending your answer…"
            : blocked || view.grant}
        </span>
        <span className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
          {order.map((choice) => {
            const a = access.find((x) => x.choice === choice)!;
            return (
              <Button
                key={choice}
                size="sm"
                // A card for something on the critical list pushes neither
                // choice: the destructive one is not the filled button.
                variant={
                  view.critical
                    ? "outline"
                    : choice === "once"
                      ? "primary"
                      : choice === "chat"
                        ? "outline"
                        : "ghost"
                }
                disabled={busy || !a.enabled}
                loading={sending === choice}
                aria-describedby={subjectId}
                data-choice={choice}
                className="[@media(pointer:coarse)]:h-11"
                onClick={() => onAnswer(choice)}
              >
                {labels[choice]}
              </Button>
            );
          })}
        </span>
      </div>
      {error && (
        <p
          role="alert"
          className="border-t border-border px-3.5 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </section>
  );
}

const closedIcon: Record<HostCardState, LucideIcon> = {
  live: SquareTerminal,
  parked: Hourglass,
  ran: Check,
  allowed: Check,
  denied: X,
  expired: TimerOff,
  stopped: Ban,
  approved: Hourglass,
  notrun: Ban,
};

/**
 * A host card whose wait ended, or a host call that ran on its own and left
 * something to undo: how it closed, what it was, and "Undo this change".
 */
export function ClosedHostCard({
  host,
  at,
  pending,
  undoError,
  onUndo,
}: {
  host: ClosedHost;
  /** When it closed (the message's time). */
  at: string;
  pending?: boolean;
  undoError?: string;
  onUndo?: (checkpoint: string) => void;
}) {
  const view = closedHostView(host);
  const Icon = closedIcon[view.state];
  const titleId = useId();
  const subjectId = useId();
  const good = view.ran;
  return (
    <section
      aria-labelledby={titleId}
      data-testid="host-closed"
      data-state={view.state}
      data-auto={view.auto ? "true" : undefined}
      className={cn(
        "max-w-full rounded-xl border border-border px-3.5 py-3 sm:max-w-[86%]",
        good ? "bg-card" : "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            good
              ? "bg-success/15 text-success-text"
              : view.state === "expired"
                ? "bg-warning/15 text-warning-text"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-3" strokeWidth={2.5} />
        </span>
        <span
          id={titleId}
          className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]"
        >
          {view.auto ? view.line : view.stateWord}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {timeOfDay(at)}
        </span>
      </div>
      <div className="mt-1.5 pl-7">
        {!view.auto && view.subject && (
          <>
            <span className="block text-xs leading-4 text-muted-foreground">
              {view.title}
            </span>
            <span className="mt-1 block text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted-foreground">
              {view.subjectLabel}
            </span>
            <pre
              id={subjectId}
              data-testid="host-subject"
              className={cn(
                "mt-0.5 whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs leading-[18px]",
                good ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {view.subject}
            </pre>
            {view.detail && (
              <>
                <span className="mt-1.5 block text-xs leading-4 text-muted-foreground">
                  {view.detailLabel}
                </span>
                <pre
                  data-testid="host-detail"
                  className={cn(
                    "mt-1 whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs leading-[18px]",
                    good ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {view.detail}
                </pre>
              </>
            )}
            {view.page && (
              <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
                {view.page}
              </p>
            )}
            {view.cwd && (
              <p className="mt-1.5 flex min-w-0 gap-1.5 text-xs leading-4 text-muted-foreground">
                <span className="shrink-0">In</span>
                <span
                  data-testid="host-cwd"
                  className="min-w-0 break-all font-mono"
                >
                  {view.cwd}
                </span>
              </p>
            )}
          </>
        )}
        {view.deviceNote && (
          <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
            {view.deviceNote}
          </p>
        )}
        {view.note && (
          <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
            {view.note}
          </p>
        )}
        {(view.canUndo || view.undone) && (
          <div className="mt-2 flex items-center gap-2">
            {view.canUndo && onUndo ? (
              <Button
                size="sm"
                variant="outline"
                className="[@media(pointer:coarse)]:h-11"
                disabled={pending}
                onClick={() => onUndo(host.checkpoint ?? "")}
              >
                <Undo2 aria-hidden />
                {HOST_UNDO}
              </Button>
            ) : view.undone ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground">
                <Undo2 aria-hidden className="size-3" />
                Undone
              </span>
            ) : null}
          </div>
        )}
        {undoError && (
          <p role="alert" className="mt-1.5 text-xs text-destructive">
            {undoError}
          </p>
        )}
      </div>
    </section>
  );
}

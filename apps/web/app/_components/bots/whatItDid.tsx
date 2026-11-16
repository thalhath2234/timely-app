"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { agoLabel, type AlertView } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { GroupLabel } from "@/app/_components/_ui/groupedList";
import type { AgentToolTrace, AgentTryResult } from "@/app/_types/types";
import { cn } from "@/app/utils/cn";
import {
  agentOutcomeWords,
  heldWords,
  tokenWords,
  type AgentCheck,
} from "./agentBot";

/** A centered sheet over the panel; Escape or the scrim closes it. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[20px] border border-border-strong bg-background outline-none sm:rounded-[20px]"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card py-3 pl-5 pr-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function Trace({ trace }: { trace: AgentToolTrace[] }) {
  if (!trace.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
      {trace.map((t, index) => (
        <li key={index} className="flex gap-1.5">
          <span className="shrink-0 font-medium text-foreground">{t.tool}</span>
          <span className="min-w-0 flex-1 break-words">
            {t.summary}
            {t.host ? ` · ${t.host}` : ""}
          </span>
          <span className="shrink-0">{t.outcome}</span>
        </li>
      ))}
    </ul>
  );
}

/** "What it did": the recent checks, what each said and did and spent, and the alerts. */
export function WhatItDid({
  checks,
  alerts,
  now,
  onClose,
}: {
  checks: readonly AgentCheck[];
  alerts: readonly AlertView[];
  now: Date;
  onClose: () => void;
}) {
  return (
    <Sheet title="What it did" onClose={onClose}>
      <GroupLabel aside={`${checks.length}`}>Checks</GroupLabel>
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checks yet.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {checks.map((c) => (
            <li
              key={c.id}
              className="rounded-[12px] border border-border bg-card px-3.5 py-2.5"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  {agentOutcomeWords(c)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {agoLabel(c.startedAt, now)}
                </span>
                {c.run?.usage ? (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {tokenWords(
                      c.run.usage.inputTokens + c.run.usage.outputTokens,
                    )}{" "}
                    tokens
                  </span>
                ) : null}
              </div>
              {c.run?.response && !c.run.silent ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-foreground">
                  {c.run.response}
                </p>
              ) : null}
              {c.error ? (
                <p className="mt-1 text-xs text-destructive">{c.error}</p>
              ) : null}
              {c.note ? (
                <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
              ) : null}
              <Trace trace={c.run?.trace ?? []} />
            </li>
          ))}
        </ol>
      )}
      {alerts.length ? (
        <>
          <GroupLabel className="mt-4" aside={`${alerts.length}`}>
            Alerts
          </GroupLabel>
          <ol className="flex flex-col gap-2">
            {alerts.map((a) => {
              const held = heldWords(a.held);
              return (
                <li
                  key={a.id}
                  className={cn(
                    "rounded-[12px] border border-border bg-card px-3.5 py-2.5",
                    a.held && "opacity-70",
                  )}
                  data-held={a.held || undefined}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                      {a.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {held || agoLabel(a.createdAt, now)}
                    </span>
                  </div>
                  {a.body ? (
                    <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                      {a.body}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </Sheet>
  );
}

/** Try it now: what a dry tick would have sent, and what it touched. Nothing was saved. */
export function TryResult({
  result,
  onClose,
}: {
  result: AgentTryResult;
  onClose: () => void;
}) {
  return (
    <Sheet title="Try it now" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        A dry run. Nothing was saved or sent.
      </p>
      {result.error ? (
        <p className="mt-2 text-[13px] text-destructive">{result.error}</p>
      ) : result.silent ? (
        <p className="mt-2 text-sm font-medium text-foreground">
          It would stay silent.
        </p>
      ) : (
        <div className="mt-2 rounded-[12px] border border-border bg-card px-3.5 py-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            It would send
          </p>
          <p className="whitespace-pre-wrap break-words text-[13px] text-foreground">
            {result.text}
          </p>
        </div>
      )}
      {result.problems.length ? (
        <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
          {result.problems.map((p, index) => (
            <li key={index}>{p}</li>
          ))}
        </ul>
      ) : null}
      <Trace trace={result.trace} />
      <p className="mt-3 text-xs tabular-nums text-muted-foreground">
        {tokenWords(result.usage.inputTokens + result.usage.outputTokens)}{" "}
        tokens · {result.usage.calls}{" "}
        {result.usage.calls === 1 ? "call" : "calls"}
      </p>
    </Sheet>
  );
}

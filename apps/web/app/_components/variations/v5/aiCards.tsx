"use client";

import type { CSSProperties } from "react";
import { Check, Sparkles } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";

/**
 * The assistant card's demo: a request, a change card, and the Approve
 * button being pressed. Nothing is applied until it is.
 */
export function ProposalDemo() {
  const { ref, frame } = useLoop(4, [1400, 1800, 1600, 3200], 3);
  const shown = frame >= 1;
  const approved = frame >= 2;
  return (
    <div ref={ref} className="flex flex-col gap-2 text-sm">
      <p className="self-end rounded-xl rounded-br-sm bg-[var(--v-raised)] px-3 py-1.5 text-[0.8125rem]">Plan Thursday around the launch</p>
      <div className={cn("transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")} aria-hidden={!shown}>
        <div className="rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] p-2.5">
          <p className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.06em] text-[var(--v-soft)] uppercase">
            <span className="size-1.5 rounded-full" style={{ background: PALETTE.violet }} aria-hidden />
            Task
            <span className="ml-auto font-medium tracking-normal normal-case text-[var(--v-faint)]">Website refresh</span>
          </p>
          <p className="mt-1 font-medium">Write the launch brief</p>
          <p className="text-xs text-[var(--v-soft)] tabular-nums">2h · Work · Thu 10:00–12:00</p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors duration-300",
                approved ? "bg-[var(--v-primary)] text-[var(--v-primary-ink)]" : "border border-[var(--v-line-strong)] text-[var(--v-ink)]",
              )}
            >
              {approved ? <Check className="size-3.5" strokeWidth={3} /> : null}
              {approved ? "Approved" : "Approve"}
            </span>
            <span className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-[var(--v-soft)] transition-opacity", approved && "opacity-40")}>
              Change
            </span>
            {approved ? <span className="v5-pop ml-auto text-[0.6875rem] text-[var(--v-soft)]">Placed on Thu</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const CHIPS = [
  { label: "Reminder", color: PALETTE.amber },
  { label: "Fri 15:00", color: PALETTE.blue },
  { label: "Personal", color: PALETTE.green },
  { label: "Health", color: PALETTE.pink },
];

/** Smart suggestions: a captured thought and the fields that fill themselves in. */
export function SuggestionsDemo() {
  const { ref, frame } = useLoop(CHIPS.length + 2, [1500, 600, 600, 600, 600, 3200]);
  const filled = Math.max(0, Math.min(CHIPS.length, frame));
  return (
    <div ref={ref} className="rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] p-2.5 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <span className="v5-check" aria-hidden />
        Dentist tomorrow 3pm
        <Sparkles className={cn("ml-auto size-3.5 text-[var(--v-primary)] transition-opacity", filled === CHIPS.length ? "opacity-0" : "opacity-100")} aria-hidden />
      </p>
      <div className="mt-2.5 flex min-h-[1.4rem] flex-wrap gap-1.5">
        {CHIPS.slice(0, filled).map((chip) => (
          <span key={chip.label} className="v5-chip" style={{ "--c": chip.color } as CSSProperties}>
            {chip.label}
          </span>
        ))}
        {filled === 0 ? <span className="text-xs text-[var(--v-faint)]">Looking at it…</span> : null}
      </div>
    </div>
  );
}

/** Agents reaching into Timely over MCP: requests go in, answers come back, one line at a time. */
export function McpDemo() {
  const { ref, frame } = useLoop(5, [1400, 1200, 1200, 1200, 3000], 4);
  const log = [
    { from: "Claude Code", text: "list this week's tasks", color: PALETTE.primary },
    { from: "Timely", text: "4 tasks · 2 scheduled · 1 reminder", color: PALETTE.green },
    { from: "Codex", text: "add “Fix pairing bug” · 1h · Thu", color: PALETTE.cyan },
    { from: "Timely", text: "added · placed Thu 14:00–15:00", color: PALETTE.green },
  ];
  return (
    <div ref={ref} className="flex flex-col gap-3 text-xs">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
        <div className="flex flex-col gap-1.5">
          {["Claude Code", "Codex"].map((agent, index) => (
            <span key={agent} className="v5-pill !h-7">
              <span className="size-1.5 rounded-full" style={{ background: index === 0 ? PALETTE.primary : PALETTE.cyan }} aria-hidden />
              {agent}
            </span>
          ))}
        </div>
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
          <path d="M0 14 H40 L100 28" fill="none" stroke="var(--v-line-strong)" strokeWidth="1.5" />
          <path d="M0 42 H40 L100 28" fill="none" stroke="var(--v-line-strong)" strokeWidth="1.5" />
          <path d="M0 14 H40 L100 28" fill="none" stroke="var(--v-primary)" strokeWidth="1.5" className="v5-dash" />
          <path d="M0 42 H40 L100 28" fill="none" stroke="var(--v-primary)" strokeWidth="1.5" className="v5-dash" />
        </svg>
        <span className="v5-pill !h-9 !border-[var(--v-primary)] !bg-[color-mix(in_oklch,var(--v-primary)_14%,transparent)]">Timely MCP</span>
      </div>
      <ol className="rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] p-2.5 font-mono text-[0.6875rem] leading-5" aria-live="off">
        {log.map((line, index) => (
          <li key={line.from + line.text} className={cn("flex gap-2 transition-opacity duration-300", index < frame ? "opacity-100" : "opacity-0")} aria-hidden={index >= frame}>
            <span className="w-[5.5rem] shrink-0 truncate" style={{ color: line.color }}>
              {line.from}
            </span>
            <span className="min-w-0 truncate text-[var(--v-soft)]">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

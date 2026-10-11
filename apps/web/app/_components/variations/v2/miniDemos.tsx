"use client";

import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { Inbox } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { ApproveRow, ChangeCard } from "./chatDemo";

/**
 * The assistant proposes one change and the visitor approves it: the card,
 * the button pressed, then the tick. Rests on the approved state.
 */
export function ProposalDemo() {
  const { ref, frame } = useLoop(3, [2600, 380, 2600], 2);
  const state = frame === 0 ? "idle" : frame === 1 ? "pressed" : "done";
  return (
    <div ref={ref} aria-hidden className="mt-5 flex flex-col gap-2.5">
      <p className="v2-thread-you !max-w-full !self-start !rounded-tl-[6px] !rounded-tr-[20px] !border-[var(--v-line-strong)] !bg-[var(--v-surface)]">
        Move the brief before Thursday&rsquo;s 1:1.
      </p>
      <ChangeCard
        change={{ kind: "task", title: "Launch brief", color: PALETTE.violet, meta: ["Fri 14:00 → Thu 10:00", "2h", "Work"] }}
        approved={state === "done"}
      />
      <ApproveRow state={state} done="Approved · moved" delay={0.2} />
    </div>
  );
}

const CHIPS = [
  { label: "Reminder", color: PALETTE.amber },
  { label: "Tue 15:00", color: PALETTE.blue },
  { label: "Personal", color: PALETTE.pink },
  { label: "Health", color: PALETTE.teal },
] as const;

/**
 * A thought lands in the Inbox and the suggestions fill in one by one:
 * what it is, when, which workspace, which label. Rests fully filled.
 */
export function SuggestDemo() {
  const { ref, frame } = useLoop(CHIPS.length + 1, [1100, 420, 420, 420, 2800], CHIPS.length);
  return (
    <div ref={ref} aria-hidden className="v2-change mt-5 !items-center">
      <span className="v2-change-icon" style={{ "--c": PALETTE.green } as CSSProperties}>
        <Inbox className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">Dentist tomorrow 3pm</p>
        <div className="mt-1.5 flex min-h-6 flex-wrap gap-1.5">
          {CHIPS.slice(0, frame).map((chip) => (
            <motion.span
              key={chip.label}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--v-surface)] px-1.5 py-0.5 text-xs text-[var(--v-ink)]"
            >
              <span className="size-1.5 rounded-full" style={{ background: chip.color }} />
              {chip.label}
            </motion.span>
          ))}
          {frame === 0 ? <span className="text-xs text-[var(--v-faint)]">Suggesting…</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Your agents on the left, Timely on the right, MCP in between. */
export function AgentWire() {
  return (
    <div aria-hidden className="mt-5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <div className="flex flex-col gap-1.5">
        {["Claude Code", "Codex", "Any agent"].map((name) => (
          <span key={name} className="v2-chip is-soft !text-xs">
            {name}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 120 24" className="h-6 w-full" preserveAspectRatio="none" fill="none">
        <line x1="0" y1="12" x2="112" y2="12" stroke={PALETTE.cyan} strokeWidth="1.5" className="v2-dash" />
        <path d="M108 7l6 5-6 5" stroke={PALETTE.cyan} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="v2-chip !border-[color-mix(in_oklch,var(--v-primary)_40%,transparent)] !bg-[var(--v2-you)] !text-xs">Timely</span>
    </div>
  );
}

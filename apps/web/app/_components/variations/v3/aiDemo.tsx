"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { cn } from "@/app/utils/cn";

/* Frames: the ask, then length, workspace and deadline fill in, then the
   proposal is approved and placed. With reduced motion it rests approved. */
const FRAMES = [900, 800, 800, 1000, 2600, 1800] as const;

const FIELDS = [
  { label: "Length", value: "2h", at: 1 },
  { label: "Workspace", value: "Work", at: 2, dot: "#6e56cf" },
  { label: "Deadline", value: "Fri", at: 3 },
] as const;

/**
 * The assistant in one card: a thought typed in, a proposal whose suggested
 * fields fill in one by one, and an Approve button that gets pressed.
 */
export default function AiDemo() {
  const { ref, frame } = useLoop(FRAMES.length, FRAMES, 4);
  const approved = frame >= 4;

  return (
    <div ref={ref} aria-hidden className="flex flex-col gap-3">
      <p className="rounded-[var(--v-radius)] border border-[var(--v-line)] bg-[var(--v-bg)] px-3 py-2.5 text-sm leading-snug text-[var(--v-ink)]">
        <span className="v3-mono mr-2 text-[var(--v-faint)]">You</span>
        Prep the launch brief before Friday, about two hours.
      </p>

      <div className="v3-card v3-card-raised overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="v3-chip v3-chip-ai">
            <Sparkles className="size-3" />
            Proposal
          </span>
          <span className="v3-mono text-[var(--v-faint)]">Task</span>
          <motion.span
            initial={false}
            animate={{ opacity: approved ? 1 : 0 }}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-[color-mix(in_oklch,var(--v3-done)_70%,white)]"
          >
            <Check className="size-3.5" strokeWidth={3} />
            Placed Thu 10:00
          </motion.span>
        </div>
        <div className="px-3">
          <p className="pb-2.5 text-[0.95rem] font-semibold">Launch brief</p>
          {FIELDS.map((field) => (
            <Field key={field.label} label={field.label} filled={frame >= field.at}>
              {"dot" in field ? <span className="size-2 rounded-full" style={{ background: field.dot }} /> : null}
              {field.value}
            </Field>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--v-line)] bg-[var(--v-surface)] px-3 py-2.5">
          <motion.span
            initial={false}
            animate={{ scale: frame === 4 ? 0.96 : 1 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[var(--v-radius)] px-3 text-xs font-semibold transition-colors duration-300",
              approved ? "bg-[var(--v3-inbox)] text-[#06190f]" : "bg-[var(--v-primary)] text-[var(--v-primary-ink)]",
            )}
          >
            {approved ? <Check className="size-3.5" strokeWidth={3} /> : null}
            {approved ? "Approved" : "Approve"}
          </motion.span>
          <span className="inline-flex h-8 items-center rounded-[var(--v-radius)] border border-[var(--v-line-strong)] px-3 text-xs font-medium text-[var(--v-soft)]">
            Change
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, filled, children }: { label: string; filled: boolean; children: ReactNode }) {
  return (
    <div className="v3-field">
      <span className="text-[var(--v-faint)]">{label}</span>
      <span className="v3-field-value">
        {filled ? (
          <motion.span
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center gap-1.5 font-medium text-[var(--v-ink)]"
          >
            {children}
            <span className="v3-mono text-[0.625rem] text-[var(--v-primary)]">suggested</span>
          </motion.span>
        ) : (
          <span className="v3-shimmer" />
        )}
      </span>
    </div>
  );
}

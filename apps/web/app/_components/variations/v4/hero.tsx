"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { Check, FileText } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";

/**
 * The hero's formulas. Each one types into the formula bar, "computes" for a
 * moment, then its result lands in a cell of the week panel. The three
 * frames per formula are typing, computing and result.
 */
const FORMULAS = [
  { text: '=SCHEDULE("Launch brief", 2h, by Fri)', cell: "B4", row: 3, result: "Thu 10:00–12:00 ✓" },
  { text: '=SUGGEST("Dentist tomorrow 3pm")', cell: "B2", row: 1, result: "Reminder · Tue 15:00" },
  { text: '=ASK("Draft the kickoff doc")', cell: "B6", row: 5, result: "Doc · 4 sections" },
] as const;

const TYPE_MS = 38;
const DELAYS = FORMULAS.flatMap((formula) => [formula.text.length * TYPE_MS + 500, 700, 2600]);
const FRAMES = FORMULAS.length * 3;

type Loop = ReturnType<typeof useLoop>;
const HeroLoop = createContext<Loop | null>(null);

/** Owns the loop so the sticky formula bar and the hero panel show the same step. */
export function HeroLoopProvider({ children }: { children: ReactNode }) {
  // Rests on the first formula with its result shown.
  const loop = useLoop(FRAMES, DELAYS, 2);
  return <HeroLoop.Provider value={loop}>{children}</HeroLoop.Provider>;
}

function useHero() {
  const loop = useContext(HeroLoop);
  if (!loop) throw new Error("HeroLoopProvider is missing");
  const index = Math.floor(loop.frame / 3);
  const phase = loop.frame % 3;
  return { ...loop, index, phase, formula: FORMULAS[index] };
}

/** The sticky formula bar under the header: cell reference, fx, the formula being typed. */
export function FormulaBar() {
  const { ref, frame, phase, formula, reduced } = useHero();
  const typing = phase === 0 && !reduced;
  return (
    <div ref={ref} className="v4-fbar" aria-hidden>
      <div className="v-container v4-fbar-inner">
        <span className="v4-ref">{formula.cell}</span>
        <span className="v4-fx">fx</span>
        <span className="v4-formula">
          <span
            key={frame}
            className={cn("v4-typing", typing && "is-typing")}
            style={{ "--n": formula.text.length, "--dur": `${formula.text.length * TYPE_MS}ms` } as CSSProperties}
          >
            {formula.text}
          </span>
          <span className="v4-caret" />
        </span>
        <span className={cn("v4-fbar-result hidden sm:inline", phase === 0 && "invisible")}>
          {phase === 1 ? "computing…" : `= ${formula.result}`}
        </span>
      </div>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Docs"] as const;

/** What already sits on the week before any formula runs. */
const FIXED: Partial<Record<number, { label: string; time: string }>> = {
  0: { label: "Standup", time: "09:30" },
  2: { label: "Design review", time: "14:00" },
};

const COMPUTED = [
  { row: 3, label: "Launch brief", time: "10:00–12:00", color: PALETTE.violet },
  { row: 1, label: "Dentist", time: "15:00", color: PALETTE.amber, reminder: true },
  { row: 5, label: "Kickoff doc", time: "4 sections", color: PALETTE.cyan, doc: true },
] as const;

/**
 * The hero's week as a small sheet: Mon to Fri plus a Docs row. The cell the
 * current formula writes to carries the selection outline; results stay
 * until the loop starts over.
 */
export function HeroWeekPanel({ className }: { className?: string }) {
  const { frame, index, phase } = useHero();
  const active = FORMULAS[index].row;
  return (
    <div className={cn("v4-cell", className)} aria-hidden>
      <div className="v4-thead" style={{ "--cols": "4.5rem minmax(0,1fr)" } as CSSProperties}>
        <span>
          <b>A</b>Day
        </span>
        <span>
          <b>B</b>Plan
        </span>
      </div>
      {DAYS.map((day, row) => {
        const fixed = FIXED[row];
        const computedIndex = COMPUTED.findIndex((item) => item.row === row);
        const computed = computedIndex >= 0 ? COMPUTED[computedIndex] : null;
        const landed = computed && frame >= computedIndex * 3 + 2;
        const isActive = row === active;
        return (
          <div key={day} className="v4-tr" style={{ "--cols": "4.5rem minmax(0,1fr)" } as CSSProperties}>
            <span className={cn("v4-td v4-td-mono", day === "Docs" && "text-[var(--v-faint)]")}>{day}</span>
            <span className={cn("v4-td", isActive && "v4-selected")}>
              {fixed ? (
                <span className="v4-chip v4-chip-muted">
                  <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">{fixed.time}</span>
                  {fixed.label}
                </span>
              ) : null}
              {computed && landed ? (
                <span className="v4-chip" style={{ "--c": computed.color } as CSSProperties}>
                  {"reminder" in computed ? (
                    <span className="size-1.5 rounded-full" style={{ background: computed.color }} />
                  ) : "doc" in computed ? (
                    <FileText className="size-3" style={{ color: computed.color }} />
                  ) : (
                    <span className="v4-mono text-[0.6875rem] text-[var(--v-soft)]">{computed.time}</span>
                  )}
                  {computed.label}
                  {"reminder" in computed || "doc" in computed ? (
                    <span className="v4-mono text-[0.6875rem] text-[var(--v-soft)]">{computed.time}</span>
                  ) : null}
                  {computedIndex === index && phase === 2 ? <Check className="size-3 text-[var(--v-primary)]" /> : null}
                </span>
              ) : isActive && phase === 1 ? (
                <span className="v4-shimmer" />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

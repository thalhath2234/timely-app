"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Calendar, Check, Circle, ListTodo, RotateCcw, Table2, X } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import { SHEET_TITLE } from "../sampleData";
import {
  Caret,
  MiniWindow,
  SceneBox,
  SceneButton,
  Typed,
  sceneEase,
  sceneSpring,
  typingTime,
  usePrefersReducedMotion,
  useScene,
} from "../scene";

const REQUEST = "Plan launch week and add this receipt to the budget.";

// 0 empty · 1 typing · 2 sent, working · 3 proposal ready (rests here)
const DELAYS = [600, typingTime(REQUEST, 28), 1500] as const;
const REVIEW = 3;
const APPLIED = 4;
const DISCARDED = 5;

const CHANGES = [
  { icon: ListTodo, action: "Create Work", detail: "Draft the announcement post · 1h" },
  { icon: Calendar, action: "Create Event", detail: "Launch day · Fri 9 Oct, all day" },
  { icon: Table2, action: `Add a row to ${SHEET_TITLE}`, detail: "Hosting · 48.00 · from the receipt" },
];

function Receipt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 29" aria-hidden className={className}>
      <path d="M2 1h20v26l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2L2 27Z" fill="#fff" stroke="#d6d3e0" />
      <path d="M6 7h12M6 11h12M6 15h7" stroke="#8b86a0" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 20h4" stroke="#17102b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Proposal({
  status,
  tone,
  applied,
  applying = false,
  discarded = false,
  footer,
}: {
  status: string;
  tone: string;
  /** How many changes have been written so far. */
  applied: number;
  /** The change after the last written one is in progress. */
  applying?: boolean;
  discarded?: boolean;
  footer: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5">
      <p className="mini-10 flex items-center gap-1.5 font-semibold" style={{ color: tone }}>
        <i className="size-1.5 rounded-full" style={{ background: tone }} />
        {status}
      </p>
      <div className="mt-2 flex flex-col gap-1">
        {CHANGES.map((change, index) => {
          const done = index < applied;
          const running = applying && index === applied;
          return (
            <div
              key={change.action}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 transition-opacity duration-300",
                discarded && "opacity-45",
              )}
            >
              <change.icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className={cn("mini-10 block truncate font-medium", discarded && "line-through")}>{change.action}</span>
                <span className="mini-9 block truncate text-muted-foreground">{change.detail}</span>
              </span>
              {done ? (
                <motion.span
                  initial={{ scale: 0.4 }}
                  animate={{ scale: 1 }}
                  transition={sceneSpring}
                  className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-success"
                >
                  <Check className="size-2.5 text-background" strokeWidth={3.5} />
                </motion.span>
              ) : running ? (
                <LogoSpinner size={14} tone="mono" className="text-primary" label="Working" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5">{footer}</div>
    </div>
  );
}

/** The proposal while its changes are written one at a time, then its finished state. */
function ApplyingProposal({ instant, onReset }: { instant: boolean; onReset: () => void }) {
  const [applied, setApplied] = useState(instant ? CHANGES.length : 0);
  const finished = applied >= CHANGES.length;

  useEffect(() => {
    if (finished) return;
    const timer = setTimeout(() => setApplied(applied + 1), applied === 0 ? 350 : 650);
    return () => clearTimeout(timer);
  }, [applied, finished]);

  return (
    <Proposal
      status={finished ? "Changes applied" : `Applying · ${applied} of ${CHANGES.length}`}
      tone={finished ? "var(--success)" : "var(--primary)"}
      applied={applied}
      applying={!finished}
      footer={
        finished ? (
          // The receipt's line, now a row in the sheet.
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={sceneSpring}
            className="w-full overflow-hidden rounded-lg border border-border bg-background"
          >
            <div className="flex items-center gap-1.5 py-1 pr-1 pl-2">
              <Table2 className="size-2.5 shrink-0 text-success" />
              <span className="mini-9 min-w-0 flex-1 truncate font-medium text-muted-foreground">
                {SHEET_TITLE} · new row
              </span>
              <SceneButton onClick={onReset}>
                <RotateCcw className="size-2.5" />
                Start over
              </SceneButton>
            </div>
            <div className="mini-10 grid grid-cols-[1fr_auto_auto] gap-x-4 border-t border-border px-2 py-1 font-mono">
              <span className="font-sans font-medium">Hosting</span>
              <span className="text-muted-foreground">2 Oct</span>
              <span>48.00</span>
            </div>
          </motion.div>
        ) : (
          <span className="mini-9 py-1 text-muted-foreground">Each change is written in its own transaction.</span>
        )
      }
    />
  );
}

function Scene() {
  const { ref, step, setStep } = useScene(DELAYS);
  const reduced = usePrefersReducedMotion();
  const sent = step >= 2;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow title="Chat · Timely AI" className="h-full">
        <div className="flex h-full flex-col gap-2.5 p-3">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {sent ? (
                <motion.div
                  key="request"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={sceneSpring}
                  className="ml-auto flex max-w-[82%] items-center gap-2 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground"
                >
                  <Receipt className="h-7 shrink-0" />
                  <span className="mini-11 leading-snug font-medium">{REQUEST}</span>
                </motion.div>
              ) : null}

              {step === 2 ? (
                <motion.p
                  key="working"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ ...sceneEase, delay: 0.3 }}
                  className="mini-10 flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground"
                >
                  <LogoSpinner size={12} label="Working" />
                  Working: reading your calendar and the receipt
                </motion.p>
              ) : null}

              {step >= REVIEW ? (
                <motion.div
                  key="proposal"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={sceneSpring}
                >
                  {step === APPLIED ? (
                    <ApplyingProposal instant={reduced} onReset={() => setStep(REVIEW)} />
                  ) : step === DISCARDED ? (
                    <Proposal
                      status="Discarded · nothing was written"
                      tone="var(--muted-foreground)"
                      applied={0}
                      discarded
                      footer={
                        <SceneButton onClick={() => setStep(REVIEW)}>
                          <RotateCcw className="size-2.5" />
                          Start over
                        </SceneButton>
                      }
                    />
                  ) : (
                    <Proposal
                      status="Ready for your review"
                      tone="var(--warning)"
                      applied={0}
                      footer={
                        <>
                          <SceneButton onClick={() => setStep(DISCARDED)}>
                            <X className="size-2.5" />
                            Discard
                          </SceneButton>
                          <SceneButton primary pulse onClick={() => setStep(APPLIED)}>
                            <Check className="size-2.5" />
                            Apply changes
                          </SceneButton>
                        </>
                      }
                    />
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-input bg-card py-1.5 pr-1.5 pl-3">
            {step === 1 ? <Receipt className="h-5 shrink-0" /> : null}
            <span className="mini-11 min-w-0 flex-1 truncate">
              {step === 1 ? (
                <>
                  <Typed text={REQUEST} speed={28} />
                  <Caret />
                </>
              ) : (
                <span className="text-muted-foreground">Ask Timely…</span>
              )}
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowUp className="size-3" />
            </span>
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function AssistantScene() {
  return (
    <SceneBox
      height={394}
      interactive
      label="Interactive demo: a chat request with a receipt photo becomes a three-step proposal you can apply or discard; applying it adds the receipt as a row in the budget sheet."
    >
      <Scene />
    </SceneBox>
  );
}

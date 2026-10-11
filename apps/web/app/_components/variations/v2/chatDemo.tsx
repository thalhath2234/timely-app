"use client";

import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Bell, Check, FileText, Globe, ListTodo, Sparkles, Table2 } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";

/**
 * The hero graphic: a chat with the assistant, styled like the app's own.
 * The visitor asks for something, Timely thinks, then answers with change
 * cards and an Approve button that gets pressed. Three scenarios loop (a
 * plan, a doc, a sheet); with reduced motion it rests on the approved plan.
 */

type Kind = "task" | "reminder" | "doc" | "sheet";

type Change = {
  kind: Kind;
  title: string;
  color: string;
  meta: string[];
  outline?: string[];
  rows?: [string, string][];
  total?: string;
};

type Scenario = {
  id: string;
  model: string;
  ask: string;
  reply: string;
  changes: Change[];
  done: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "plan",
    model: "Claude subscription",
    ask: "Prep the launch brief by Friday, about 2 hours, and remind me to call the landlord tomorrow at 9.",
    reply: "Two changes for you to look over:",
    changes: [
      { kind: "task", title: "Launch brief", color: PALETTE.violet, meta: ["2h", "Work", "Thu 10:00–12:00", "Due Fri"] },
      { kind: "reminder", title: "Call the landlord", color: PALETTE.amber, meta: ["Tue 09:00", "Personal"] },
    ],
    done: "Approved · 2 changes made",
  },
  {
    id: "doc",
    model: "ChatGPT subscription",
    ask: "Write a kickoff doc for the Website project.",
    reply: "Here is a first draft, filed under Website:",
    changes: [
      {
        kind: "doc",
        title: "Website kickoff",
        color: PALETTE.cyan,
        meta: ["Website", "3 sections"],
        outline: ["Goals and audience", "Pages and scope", "Timeline and owners"],
      },
    ],
    done: "Approved · doc created",
  },
  {
    id: "sheet",
    model: "Your own key",
    ask: "Track the launch budget.",
    reply: "A sheet with the first rows filled in:",
    changes: [
      {
        kind: "sheet",
        title: "Launch budget",
        color: PALETTE.green,
        meta: ["Website", "Item · Cost"],
        rows: [
          ["Ads", "1,200"],
          ["Photography", "800"],
          ["Domain", "40"],
        ],
        total: "2,040",
      },
    ],
    done: "Approved · sheet created",
  },
];

const ICONS = { task: ListTodo, reminder: Bell, doc: FileText, sheet: Table2 } as const;
const KIND_LABEL = { task: "Task", reminder: "Reminder", doc: "Doc", sheet: "Sheet" } as const;

/**
 * Frames per scenario: proposal shown, Approve pressed, approved, then the
 * next scenario's ask and its thinking dots. Starting on the proposal means
 * the panel is full the moment the page loads.
 */
const STEPS = 5;
const DELAYS = [3000, 380, 2600, 900, 1100] as const;
const EASE = [0.22, 1, 0.36, 1] as const;

export function ChangeCard({ change, approved, index = 0 }: { change: Change; approved: boolean; index?: number }) {
  const Icon = ICONS[change.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + index * 0.14, ease: EASE }}
      className="v2-change"
      style={{ "--c": change.color } as CSSProperties}
    >
      <span className="v2-change-icon">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="v2-label">{KIND_LABEL[change.kind]}</p>
        <p className="mt-0.5 text-[0.9375rem] font-semibold">{change.title}</p>
        <div className="v2-change-meta">
          {change.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        {change.outline ? (
          <ol className="v2-outline">
            {change.outline.map((line, i) => (
              <li key={line}>
                {i + 1}. {line}
              </li>
            ))}
          </ol>
        ) : null}
        {change.rows ? (
          <div className="v2-grid-rows">
            {change.rows.map(([item, cost]) => (
              <SheetRow key={item} item={item} cost={cost} />
            ))}
            <span className="is-total">
              Total <span className="font-mono text-[0.7rem] font-normal text-[var(--v-soft)]">=SUM(B2:B4)</span>
            </span>
            <span className="is-total">{change.total}</span>
          </div>
        ) : null}
      </div>
      <span className={cn("v2-tick", approved && "is-on")}>{approved ? <Check className="size-3" strokeWidth={3} /> : null}</span>
    </motion.div>
  );
}

function SheetRow({ item, cost }: { item: string; cost: string }) {
  return (
    <>
      <span>{item}</span>
      <span>{cost}</span>
    </>
  );
}

/** Approve and Change buttons, then the "approved" line once pressed. */
export function ApproveRow({ state, done, delay = 0.4 }: { state: "idle" | "pressed" | "done"; done: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay }} className="flex h-9 items-center gap-2">
      {state === "done" ? (
        <motion.p initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="v2-done">
          <Check className="size-3.5" strokeWidth={3} />
          {done}
        </motion.p>
      ) : (
        <>
          <span className={cn("v2-btn-sm is-primary", state === "pressed" && "is-pressed")}>
            <Check className="size-3.5" strokeWidth={3} />
            Approve
          </span>
          <span className="v2-btn-sm is-ghost">Change</span>
        </>
      )}
    </motion.div>
  );
}

export function Typing() {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="v2-typing">
      <span />
      <span />
      <span />
    </motion.div>
  );
}

function Composer({ children }: { children?: ReactNode }) {
  return (
    <div className="v2-composer mx-4 mb-4 sm:mx-5 sm:mb-5">
      <p className="v2-composer-text">Ask Timely to create, plan, or update…</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs text-[var(--v-faint)]">
          <Globe className="size-3.5" />
          Web search
          {children}
        </span>
        <span className="v2-send">
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}

export default function ChatDemo({ className }: { className?: string }) {
  const { ref, frame } = useLoop(SCENARIOS.length * STEPS, DELAYS, 2);
  const step = frame % STEPS;
  const slot = Math.floor(frame / STEPS) + (step >= 3 ? 1 : 0);
  const scenario = SCENARIOS[slot % SCENARIOS.length];
  const showReply = step <= 2;
  const approveState = step === 2 ? "done" : step === 1 ? "pressed" : "idle";

  return (
    <div ref={ref} aria-hidden className={cn("v2-panel", className)}>
      <div className="v2-panel-head">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--v-primary)_16%,transparent)] text-[var(--v-primary)]">
            <Sparkles className="size-3.5" />
          </span>
          Timely assistant
        </span>
        <span className="v2-chip is-soft !text-xs">
          <span className="size-1.5 rounded-full bg-[var(--v2-green)]" />
          {scenario.model}
        </span>
      </div>

      <div className="v2-thread">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={scenario.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-3"
          >
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="v2-thread-you"
            >
              {scenario.ask}
            </motion.p>

            {step === 4 ? <Typing /> : null}

            {showReply ? (
              <>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="v2-thread-reply"
                >
                  {scenario.reply}
                </motion.p>
                {scenario.changes.map((change, index) => (
                  <ChangeCard key={change.title} change={change} approved={step === 2} index={index} />
                ))}
                <ApproveRow state={approveState} done={scenario.done} delay={0.3 + scenario.changes.length * 0.14} />
              </>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <Composer />
    </div>
  );
}

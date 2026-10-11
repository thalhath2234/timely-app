"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "./hooks";
import { Hand, Stamp, Tick } from "./ink";

const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

/* ---- Fig. 1.1: one chat, whichever plan you sign in with ---- */

const PROVIDERS = [
  { name: "Claude Code", plan: "your Claude Pro or Max plan", model: "Sonnet (latest)" },
  { name: "Codex", plan: "your ChatGPT plan", model: "Codex default" },
  { name: "OpenCode Go", plan: "your OpenCode Go plan", model: "From your Go plan" },
  { name: "Ollama", plan: "a model on this computer", model: "Local model" },
  { name: "API key", plan: "OpenRouter, Anthropic, Gemini…", model: "Any model you pick" },
];

export function FigModels() {
  const { ref, frame } = useLoop(PROVIDERS.length, 2300, 0);
  const active = PROVIDERS[frame];
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A list of sign-ins: Claude Code, Codex, OpenCode Go, Ollama and an API key. Choosing one changes the model in the chat header; the chat stays the same."
      className="d2-sheet grid gap-5 border border-[var(--rule-2)] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:p-6"
    >
      <ol className="border-t border-[var(--rule-3)]">
        {PROVIDERS.map((provider, index) => {
          const on = index === frame;
          return (
            <li key={provider.name} className="flex items-center gap-3 border-b border-[var(--rule)] py-2">
              <span className="d2-mono w-5 text-[10px] text-[var(--ink-3)]">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("d2-serif block text-[1.05rem] leading-tight transition-colors", on ? "text-[var(--ink)]" : "text-[var(--ink-2)]")}>
                  {provider.name}
                </span>
                <span className="block truncate text-[11px] text-[var(--ink-3)]">{provider.plan}</span>
              </span>
              <Tick on={on} className="h-4 w-5 shrink-0" />
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col border border-[var(--rule-2)] bg-[var(--paper)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--rule-2)] px-3 py-2">
          <span className="d2-serif text-base italic">Chat</span>
          <span className="relative flex h-7 min-w-0 items-center overflow-hidden border border-[var(--rule-3)] px-2.5 text-[11px]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={active.model}
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={spring}
                className="d2-mono whitespace-nowrap"
              >
                {active.model} ▾
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2.5 p-3">
          <p className="ml-auto max-w-[85%] border border-[var(--rule-3)] px-2.5 py-1.5 text-[12px]">What should I do next?</p>
          <motion.p
            key={frame}
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="d2-serif max-w-[95%] text-[14px] leading-snug text-[var(--ink-2)]"
          >
            Finish <span className="text-[var(--ink)]">Launch brief</span> first: it is due Friday and two tasks wait on
            it. You have a free 2-hour slot at 10:00.
          </motion.p>
          <p className="d2-mono mt-1 border-t border-dashed border-[var(--rule-2)] pt-2 text-[10px] text-[var(--ink-3)]">
            running on <span className="text-[var(--verm-2)]">{active.plan}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Fig. 1.2: a request becomes a proposal you apply or discard ---- */

const PLAN = [
  "New project “Website launch”",
  "8 tasks in 3 stages",
  "Doc “Launch brief”",
  "Sheet “Launch budget”",
  "6 blocks placed this week",
];

export function FigProposal() {
  const { ref, frame } = useLoop(8, [1300, 550, 550, 550, 550, 750, 900, 2800], 7);
  const shown = Math.min(frame, PLAN.length);
  const pressing = frame === 6;
  const applied = frame === 7;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="You ask: plan the website launch for the end of the month, with a budget. The assistant proposes five changes, a project, eight tasks, a doc, a sheet and six calendar blocks, with Apply changes and Discard buttons. Apply changes is pressed and the proposal is stamped Applied."
      className="relative"
    >
      <p className="d2-hand ml-auto w-fit max-w-[92%] rotate-[-1.5deg] text-right text-[1.45rem] leading-tight text-[var(--ink)] sm:text-[1.6rem]">
        “Plan the website launch for the end of the month, with a budget.”
      </p>
      <div className="d2-sheet relative mt-4 overflow-hidden border border-[var(--rule-2)] p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule-2)] pb-2">
          <p className="d2-serif text-lg italic">Proposed changes</p>
          <p className="d2-mono text-[10px] text-[var(--ink-3)] uppercase">{applied ? "applied" : `${shown} of 5 · needs review`}</p>
        </div>
        <ol className="mt-2">
          {PLAN.map((line, index) => {
            const on = index < shown;
            return (
              <motion.li
                key={line}
                initial={false}
                animate={{ opacity: on ? 1 : 0.18 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-3 border-b border-dotted border-[var(--rule-2)] py-[7px] text-[13.5px]"
              >
                <span className="d2-mono w-4 text-[10px] text-[var(--ink-3)]">{index + 1}.</span>
                <span className="flex-1">{line}</span>
                <span className="relative size-4 border border-[var(--rule-3)]">
                  <Tick on={applied} delay={index * 0.08} className="absolute -top-1 -left-0.5 h-5 w-6" />
                </span>
              </motion.li>
            );
          })}
        </ol>
        <div className="mt-4 flex items-center gap-2">
          <motion.span
            initial={false}
            animate={pressing ? { scale: [1, 0.92, 1] } : { scale: 1 }}
            transition={{ duration: 0.35 }}
            className="inline-flex h-9 items-center bg-[var(--verm)] px-3.5 text-[13px] font-semibold text-[var(--verm-ink)]"
          >
            Apply changes
          </motion.span>
          <span className="inline-flex h-9 items-center border border-[var(--rule-3)] px-3.5 text-[13px] text-[var(--ink-2)]">Discard</span>
        </div>
        <Stamp on={applied} angle={-11} className="top-1.5 right-3 px-2.5 pt-1.5 pb-1 text-[1.45rem] sm:top-auto sm:right-8 sm:bottom-5 sm:px-3 sm:pt-2 sm:pb-1.5 sm:text-[2.1rem]">
          Applied
        </Stamp>
      </div>
    </div>
  );
}

/* ---- Fig. 1.3: Clarify fills itself in, in pencil, then sets it in type ---- */

const FIELDS = [
  { label: "Project", value: "Fundraising", w: 110 },
  { label: "Labels", value: "writing", w: 74 },
  { label: "Due", value: "Fri 16 Oct", w: 100 },
  { label: "Length", value: "2h", w: 30 },
];

export function FigClarify() {
  const { ref, frame } = useLoop(7, [1000, 850, 850, 850, 950, 1000, 2600], 6);
  const set = frame >= 5;
  const saved = frame === 6;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="The Clarify dialog for 'Draft the Q3 investor update before Friday'. Suggestions pencil in project Fundraising, label writing, due Friday 16 October and length 2 hours, then set them as fields. Nothing changes until Save."
      className="d2-sheet relative border border-[var(--rule-2)] p-4 sm:p-6"
    >
      <p className="d2-kicker">Clarify · Work</p>
      <p className="d2-serif mt-2 text-[1.3rem] leading-snug sm:text-[1.45rem]">Draft the Q3 investor update before Friday</p>
      <dl className="mt-4 grid grid-cols-2 border-t border-l border-[var(--rule-2)]">
        {FIELDS.map((field, index) => {
          const pencilled = frame >= index + 1;
          return (
            <div key={field.label} className="relative h-[62px] border-r border-b border-[var(--rule-2)] px-3 pt-1.5">
              <dt className="d2-mono text-[10px] tracking-wider text-[var(--ink-3)] uppercase">{field.label}</dt>
              <dd className="relative mt-0.5 h-7">
                <motion.span
                  initial={false}
                  animate={{ opacity: set ? 0 : 1, y: set ? -4 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 text-[var(--ink-2)]"
                >
                  <Hand text={field.value} on={pencilled} width={field.w} size={23} duration={0.6} />
                </motion.span>
                <motion.span
                  initial={false}
                  animate={{ opacity: set ? 1 : 0, y: set ? 0 : 4 }}
                  transition={{ duration: 0.35, delay: set ? index * 0.07 : 0 }}
                  className="absolute inset-0 flex items-center text-[15px] font-medium"
                >
                  {field.value}
                </motion.span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="d2-serif text-[13px] text-[var(--ink-3)] italic">Nothing changes until you save.</span>
        <span
          className={cn(
            "inline-flex h-9 items-center px-4 text-[13px] font-semibold transition-colors duration-300",
            saved ? "bg-[var(--ink)] text-[var(--paper)]" : "border border-[var(--rule-3)] text-[var(--ink)]",
          )}
        >
          {saved ? "Saved ✓" : "Save"}
        </span>
      </div>
      <p aria-hidden className="d2-hand absolute -top-4 right-3 rotate-[3deg] text-[1.35rem] text-[var(--verm-2)] sm:-right-4">
        suggested ↓
      </p>
    </div>
  );
}

/* ---- Fig. 1.4: your agent's calls, printed on continuous paper ---- */

const CALLS = [
  { tool: "get_agenda", note: "3 events, 5 blocks today" },
  { tool: "what_next", note: "Launch brief, due Fri" },
  { tool: "create_task", note: "“Send deck to Sam”, 30m" },
  { tool: "auto_schedule_apply", note: "placed 2 blocks" },
];

export function FigAgents() {
  const { ref, frame } = useLoop(6, [900, 900, 900, 900, 1300, 2600], 5);
  const shown = Math.min(frame + 1, CALLS.length);
  const placed = frame >= 4;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A printout of an agent's calls to Timely's MCP server: get_agenda, what_next, create_task and auto_schedule_apply, which places two blocks on Monday."
      className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
    >
      <div className="relative bg-[#0f0d0a] py-4 pr-4 pl-9 shadow-[0_24px_50px_-26px_rgb(0_0_0/0.9)]">
        {/* Tractor-feed holes */}
        <div aria-hidden className="absolute inset-y-0 left-0 flex w-6 flex-col justify-around border-r border-dashed border-[var(--rule-2)] py-2">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className="mx-auto size-2 rounded-full bg-[var(--paper)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.8)]" />
          ))}
        </div>
        <p className="d2-mono text-[10.5px] text-[var(--ink-3)]">claude-code ⇢ timely mcp · personal key</p>
        <ol className="d2-mono mt-3 space-y-2 text-[11.5px] leading-snug">
          {CALLS.map((call, index) => (
            <motion.li
              key={call.tool}
              initial={false}
              animate={{ opacity: index < shown ? 1 : 0.12 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-[1.4rem_minmax(0,1fr)]"
            >
              <span className="text-[var(--ink-3)]">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="text-[var(--verm-2)]">→ {call.tool}</span>
                <span className="block truncate text-[var(--ink-2)]">{call.note}</span>
              </span>
            </motion.li>
          ))}
        </ol>
      </div>
      <div className="d2-sheet border border-[var(--rule-2)] p-3">
        <p className="d2-serif text-base">
          Mon <span className="italic text-[var(--ink-3)]">12 Oct</span>
        </p>
        <div className="relative mt-2 h-[150px] border-l border-[var(--rule-2)]">
          {[0, 1, 2, 3, 4].map((row) => (
            <span key={row} className="absolute inset-x-0 border-t border-[var(--rule)]" style={{ top: `${row * 25}%` }} />
          ))}
          <span className="d2-hatch absolute top-[2%] right-1 left-1 h-[18%] border border-[var(--rule-3)] px-1.5 text-[10px] text-[var(--ink-2)]">
            Weekly planning
          </span>
          {[
            { top: "27%", h: "26%", title: "Launch brief" },
            { top: "62%", h: "14%", title: "Send deck to Sam" },
          ].map((block, index) => (
            <motion.span
              key={block.title}
              initial={false}
              animate={{ clipPath: placed ? "inset(0% 0% 0% 0%)" : "inset(0% 100% 0% 0%)" }}
              transition={{ duration: 0.45, delay: placed ? index * 0.2 : 0, ease: [0.65, 0, 0.35, 1] }}
              className="absolute right-1 left-1 bg-[var(--ink)] px-1.5 text-[10.5px] leading-[1.5] font-medium text-[var(--paper)]"
              style={{ top: block.top, height: block.h }}
            >
              {block.title}
            </motion.span>
          ))}
        </div>
        <p className="d2-mono mt-2 text-[10px] text-[var(--ink-3)]">Claude Code · Codex · any MCP client</p>
      </div>
    </div>
  );
}

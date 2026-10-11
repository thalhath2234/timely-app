"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, MousePointer2 } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { NOTE, Tape, noteStyle } from "./paper";
import { drop, settle, useLoop } from "./motionKit";

/* ---- 1. A stack of index cards: the plan you already pay for ---- */

const PROVIDERS = [
  { name: "Claude Code", runs: "Your Claude Pro or Max plan", how: "Uses the Claude Code sign-in on this computer", model: "Sonnet (latest)" },
  { name: "Codex", runs: "Your ChatGPT plan", how: "Uses the Codex sign-in on this computer", model: "Codex default" },
  { name: "OpenCode Go", runs: "Your OpenCode Go subscription", how: "Sign in once in Settings", model: "From your Go plan" },
  { name: "Ollama", runs: "Models on your own computer", how: "Nothing leaves the machine", model: "Local model" },
  { name: "API key", runs: "OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral and more", how: "Paste a key, pick a model", model: "Any model you pick" },
];

function ProviderStack() {
  const { ref, frame } = useLoop(PROVIDERS.length, 2200, 0);
  const count = PROVIDERS.length;
  return (
    <div ref={ref} aria-hidden className="relative mx-auto h-[300px] w-full max-w-[440px] sm:h-[310px]">
      {PROVIDERS.map((provider, index) => {
        const depth = (index - frame + count) % count;
        const leaving = depth === count - 1;
        const rotate = [-2.5, 2, -1, 3, -3][index];
        const base = { y: depth * 9, rotate: depth === 0 ? -1.2 : rotate, scale: 1 - depth * 0.025 };
        return (
          <motion.div
            key={provider.name}
            initial={false}
            animate={
              leaving
                ? {
                    x: ["0%", "62%", "0%"],
                    y: [0, -24, base.y],
                    rotate: [-1.2, 14, base.rotate],
                    scale: [1, 1, base.scale],
                    zIndex: [20, 20, 1],
                  }
                : { x: "0%", ...base, zIndex: count - depth + 1 }
            }
            transition={leaving ? { duration: 0.95, times: [0, 0.45, 1], ease: "easeInOut" } : settle}
            className="d6-paper d6-ruled absolute inset-x-0 top-6 h-[230px] overflow-hidden px-5 pt-4 sm:px-6"
            style={{ backgroundPosition: "0 46px" }}
          >
            <span className="absolute inset-x-0 top-[70px] h-[2px] bg-[#e5484d]/45" />
            <p className="d6-display text-[1.6rem] leading-tight font-extrabold">{provider.name}</p>
            <p className="mt-1 text-[0.82rem] font-medium text-[var(--paper-soft)]">{provider.how}</p>
            <p className="d6-hand mt-5 text-[1.15rem] leading-[26px] font-bold">Runs on: {provider.runs}</p>
            <span className="absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-white/60 px-2.5 py-1 text-[0.72rem] font-semibold">
              Model for this chat: {provider.model}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- 2. A proposal on a legal pad: Apply changes or Discard ---- */

const CHANGES = [
  "New project “Website launch”",
  "8 tasks in 3 stages",
  "Doc “Launch brief”",
  "Sheet “Launch budget”",
  "6 blocks placed this week",
];

function ReviewPad() {
  const { ref, frame } = useLoop(9, [1300, 550, 550, 550, 550, 900, 900, 2600, 600], 7);
  const shown = Math.min(Math.max(frame, 0), CHANGES.length);
  const all = frame >= 5 && frame <= 7;
  const visible = frame === 8 ? 0 : all ? CHANGES.length : shown;
  const hovering = frame === 6;
  const applied = frame === 7;
  return (
    <div ref={ref} aria-hidden className="relative mx-auto w-full max-w-[400px] pt-3">
      <div className="d6-note relative px-5 pt-4 pb-5 sm:px-6" style={noteStyle("yellow", 1.2)}>
        <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-3deg]" />
        <p className="rounded-lg bg-[var(--paper-ink)] px-3 py-2 text-[0.82rem] leading-snug font-medium text-[var(--n-cream)]">
          Plan the website launch for the end of the month, with a budget.
        </p>
        <p className="mt-4 flex items-center justify-between text-[0.8rem] font-bold">
          <span>{applied ? "Applied" : "Needs your review"}</span>
          <span className="d6-mono font-medium text-[var(--paper-soft)]">{visible} changes</span>
        </p>
        <ul className="mt-2 space-y-1.5">
          {CHANGES.map((change, index) => {
            const on = index < visible;
            return (
              <motion.li
                key={change}
                initial={false}
                animate={{ x: on ? 0 : -6, opacity: on ? 1 : 0.18 }}
                transition={settle}
                className="flex items-center gap-2 border-b border-black/10 pb-1.5 text-[0.86rem] font-medium"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-[var(--paper-ink)] transition-colors",
                    applied && "bg-[var(--paper-ink)] text-[var(--n-yellow)]",
                  )}
                >
                  {applied ? <Check className="size-3" strokeWidth={3.5} /> : null}
                </span>
                {change}
              </motion.li>
            );
          })}
        </ul>
        <div className="relative mt-4 flex gap-2">
          <motion.span
            animate={hovering ? { scale: [1, 0.93, 1] } : { scale: 1 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="rounded-lg bg-[var(--paper-ink)] px-3.5 py-2 text-[0.8rem] font-bold text-[var(--n-cream)]"
          >
            Apply changes
          </motion.span>
          <span className="rounded-lg border-[1.5px] border-black/25 px-3.5 py-2 text-[0.8rem] font-bold">Discard</span>
          <AnimatePresence>
            {hovering ? (
              <motion.span
                key="cursor"
                initial={{ x: 120, y: 40 }}
                animate={{ x: 70, y: 18 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="absolute top-0 left-0"
              >
                <MousePointer2 className="size-5 fill-white text-black" />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {applied ? (
          <motion.span
            key="sticker"
            initial={{ scale: 1.8, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: -12, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={drop}
            className="d6-display absolute -right-1 bottom-6 flex size-[78px] items-center justify-center rounded-full bg-[var(--n-green)] text-center text-[0.95rem] leading-none font-extrabold text-[var(--paper-ink)] shadow-[0_8px_18px_-6px_rgb(0_0_0/0.7)] sm:-right-5"
          >
            Applied
            <br />5 of 5
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- 3. Clarify: stickers fill in the details ---- */

const STICKERS = [
  { label: "Type", value: "Work", color: "blue" as const, rotate: -4 },
  { label: "Length", value: "2h", color: "yellow" as const, rotate: 3 },
  { label: "Priority", value: "High", color: "orange" as const, rotate: -2 },
  { label: "Project", value: "Fundraising", color: "green" as const, rotate: 2 },
  { label: "Label", value: "writing", color: "violet" as const, rotate: -3 },
];

function ClarifyNote() {
  const { ref, frame } = useLoop(8, [1100, 500, 500, 500, 500, 700, 1300, 2600], 7);
  const filled = Math.min(frame, STICKERS.length);
  const duplicate = frame >= 6;
  const saved = frame === 7;
  return (
    <div ref={ref} aria-hidden className="relative mx-auto w-full max-w-[400px] pt-3">
      <div className="d6-note min-h-[290px] px-5 pt-5 pb-5 sm:px-6" style={noteStyle("pink", -1.5)}>
        <p className="d6-mono text-[0.7rem] font-semibold tracking-wide text-[var(--paper-soft)] uppercase">Clarify</p>
        <p className="d6-hand mt-1 text-[1.45rem] leading-[1.15] font-bold">Draft the Q3 investor update before Friday</p>
        <div className="mt-4 flex min-h-[74px] flex-wrap content-start gap-2">
          {STICKERS.map((sticker, index) => {
            const on = index < filled;
            return (
              <span key={sticker.label} className="relative inline-flex flex-col rounded-md border-[1.5px] border-dashed border-black/30 px-2.5 py-1">
                <span className="text-[0.62rem] font-semibold text-[var(--paper-soft)]">{sticker.label}</span>
                <span className="invisible text-[0.85rem] leading-tight font-bold whitespace-nowrap">✦ {sticker.value}</span>
                <motion.span
                  initial={false}
                  animate={on ? { scale: 1, rotate: sticker.rotate, y: 0, opacity: 1 } : { scale: 1.5, rotate: sticker.rotate * 3, y: -18, opacity: 0 }}
                  transition={drop}
                  className="absolute -inset-[1.5px] inline-flex flex-col rounded-md px-2.5 py-1 shadow-[0_2px_4px_rgb(0_0_0/0.25)]"
                  style={{ background: NOTE[sticker.color] }}
                >
                  <span className="text-[0.62rem] font-semibold text-[var(--paper-soft)]">{sticker.label}</span>
                  <span className="text-[0.85rem] leading-tight font-bold whitespace-nowrap">✦ {sticker.value}</span>
                </motion.span>
              </span>
            );
          })}
        </div>
        <motion.p
          initial={false}
          animate={{ opacity: duplicate ? 1 : 0, y: duplicate ? 0 : 6 }}
          transition={settle}
          className="mt-4 flex items-start gap-1.5 rounded-md border border-dashed border-black/30 px-2.5 py-1.5 text-[0.78rem] leading-snug font-medium"
        >
          <Copy className="mt-0.5 size-3.5 shrink-0" />
          Looks like “Investor update draft” is already in your Inbox
        </motion.p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[0.75rem] font-medium text-[var(--paper-soft)]">Nothing changes until you save</span>
          <motion.span
            animate={saved ? { scale: [1, 0.92, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className="rounded-lg bg-[var(--paper-ink)] px-3.5 py-1.5 text-[0.8rem] font-bold text-[var(--n-cream)]"
          >
            {saved ? "Saved" : "Save"}
          </motion.span>
        </div>
      </div>
    </div>
  );
}

/* ---- 4. A receipt roll of MCP tool calls ---- */

const CALLS = [
  { tool: "get_agenda", note: "3 events, 5 blocks today" },
  { tool: "what_next", note: "Launch brief, due Fri" },
  { tool: "create_task", note: "“Send deck to Sam”" },
  { tool: "auto_schedule_apply", note: "placed 2 blocks" },
];

function AgentReceipt() {
  const { ref, frame } = useLoop(6, [900, 800, 800, 800, 2600, 500], 4);
  const shown = frame === 5 ? 0 : Math.min(frame + 1, CALLS.length);
  return (
    <div ref={ref} aria-hidden className="relative mx-auto flex w-full max-w-[520px] flex-col items-stretch gap-4 sm:flex-row sm:items-start">
      <div className="d6-receipt d6-mono relative w-full px-5 pt-5 pb-8 text-[0.8rem] sm:w-[62%] sm:rotate-[-1.5deg]" style={{ boxShadow: "none" }}>
        <p className="text-center text-[0.72rem] font-semibold tracking-[0.14em] uppercase">Timely MCP server</p>
        <p className="mt-0.5 text-center text-[0.7rem] text-black/55">your agent · personal key ····3f9a</p>
        <p className="my-3 border-t border-dashed border-black/30" />
        <ul className="space-y-2.5">
          {CALLS.map((call, index) => {
            const on = index < shown;
            return (
              <motion.li
                key={call.tool}
                initial={false}
                animate={{ opacity: on ? 1 : 0.15, y: on ? 0 : -4 }}
                transition={settle}
                className="leading-snug"
              >
                <span className="font-bold">→ {call.tool}</span>
                <span className="block pl-4 text-black/60">{call.note}</span>
              </motion.li>
            );
          })}
        </ul>
        <p className="my-3 border-t border-dashed border-black/30" />
        <p className="flex justify-between text-[0.72rem]">
          <span>tools available</span>
          <span className="font-bold">150+</span>
        </p>
        <p className="flex justify-between text-[0.72rem]">
          <span>deletes</span>
          <span className="font-bold">ask first</span>
        </p>
      </div>
      <div className="flex flex-row flex-wrap gap-2 sm:w-[38%] sm:flex-col sm:pt-4">
        {[
          { name: "Claude Code", color: "orange" as const, r: 2 },
          { name: "Codex", color: "blue" as const, r: -2 },
          { name: "Any MCP client", color: "cream" as const, r: 1.5 },
        ].map((client) => (
          <span
            key={client.name}
            className="d6-note d6-hand px-3 py-2 text-[1.05rem] leading-tight font-bold"
            style={noteStyle(client.color, client.r)}
          >
            {client.name}
          </span>
        ))}
        <span className="d6-faint text-[0.8rem] sm:pl-1">connect with a key you can revoke</span>
      </div>
    </div>
  );
}

const SPOTS = [
  {
    key: "plan",
    title: "Bring the plan you already pay for",
    body: (
      <>
        Claude Code and Codex use the sign-in already on your computer, so chats run on your Claude or ChatGPT
        subscription. Or use OpenCode Go, local models through Ollama, or an API key for OpenRouter, Anthropic,
        OpenAI, Gemini, DeepSeek, xAI, Mistral and more. Pick the model per chat.
      </>
    ),
    graphic: <ProviderStack />,
    span: "lg:col-span-7",
  },
  {
    key: "review",
    title: "It proposes. You approve.",
    body: (
      <>
        Ask for a plan and the assistant drafts the projects, tasks, events, docs and sheets. Bigger changes wait on a
        review card: nothing is written until you choose <strong className="text-[var(--ink)]">Apply changes</strong>,
        and <strong className="text-[var(--ink)]">Discard</strong> drops the lot.
      </>
    ),
    graphic: <ReviewPad />,
    span: "lg:col-span-5",
  },
  {
    key: "suggest",
    title: "Suggestions while you clarify",
    body: (
      <>
        Type a thought and Clarify suggests the type, length, priority, project and labels from your words, and points
        out a likely duplicate. You accept or change each one; nothing is saved until you save.
      </>
    ),
    graphic: <ClarifyNote />,
    span: "lg:col-span-5",
  },
  {
    key: "mcp",
    title: "Your own agents, over MCP",
    body: (
      <>
        Timely has a built-in MCP server with more than 150 tools. Give Claude Code, Codex or any MCP client a personal
        key and it can read and plan your calendar, tasks, docs and sheets. Deleting things needs the agent to confirm
        first, and you can revoke a key at any time.
      </>
    ),
    graphic: <AgentReceipt />,
    span: "lg:col-span-7",
  },
];

export default function AiDesk() {
  return (
    <div className="mt-14 grid gap-x-10 gap-y-16 lg:grid-cols-12">
      {SPOTS.map((spot) => (
        <article key={spot.key} className={cn("flex flex-col", spot.span)}>
          <div className="flex min-h-[300px] items-center sm:min-h-[340px]">{spot.graphic}</div>
          <h3 className="d6-display mt-8 text-[1.6rem] leading-tight font-extrabold">{spot.title}</h3>
          <p className="d6-soft mt-2.5 max-w-xl leading-relaxed">{spot.body}</p>
        </article>
      ))}
    </div>
  );
}

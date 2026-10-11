"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Check,
  ChevronDown,
  FilePlus2,
  ListPlus,
  MoveRight,
  Sparkles,
  CalendarPlus,
  type LucideIcon,
} from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import { useFrames } from "./shell";

const ease = [0.22, 1, 0.36, 1] as const;
const soft = { type: "spring", stiffness: 170, damping: 24 } as const;

/* ---- 1. The model picker: your own plan, chosen per chat ---- */

const MODELS = [
  {
    id: "claude",
    name: "Claude Code",
    note: "Your Claude Pro or Max plan",
    group: 0,
  },
  { id: "codex", name: "Codex", note: "Your ChatGPT plan", group: 0 },
  { id: "go", name: "OpenCode Go", note: "Your Go subscription", group: 1 },
  {
    id: "ollama",
    name: "Ollama",
    note: "Local models on this computer",
    group: 1,
  },
];
const KEYS = ["OpenRouter", "Anthropic", "OpenAI", "Gemini", "DeepSeek", "xAI", "Mistral"];
const GROUPS = ["Signed in on this computer", "Subscription or local"];
const PICKER_MS = [2400, 2400, 2400, 2400, 2400] as const;

function ModelPicker() {
  const { ref, frame } = useFrames(5, PICKER_MS, 0);
  const current = frame < 4 ? MODELS[frame].name : "OpenRouter";
  return (
    <div ref={ref} className="panel overflow-hidden" aria-hidden>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <TimelyLogo size={16} tone="mono" className="text-[var(--mint)]" />
          New chat
        </span>
        <span className="relative flex h-8 min-w-[9.5rem] items-center justify-between gap-2 overflow-hidden rounded-full border border-[var(--line-2)] px-3 text-[13.5px]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={current}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={soft}
              className="whitespace-nowrap"
            >
              {current}
            </motion.span>
          </AnimatePresence>
          <ChevronDown className="size-3.5 text-[var(--faint)]" />
        </span>
      </div>
      <div className="grid gap-4 p-3 sm:p-4">
        {GROUPS.map((group, g) => (
          <div key={group}>
            <p className="px-2 pb-1.5 text-[12px] font-semibold tracking-[0.12em] text-[var(--faint)] uppercase">
              {group}
            </p>
            <ul className="grid gap-0.5">
              {MODELS.filter((model) => model.group === g).map((model) => {
                const on = MODELS[frame]?.id === model.id;
                return (
                  <li key={model.id} className="relative flex items-center gap-3 rounded-xl px-3 py-2.5">
                    {on ? (
                      <motion.span
                        layoutId="d5-model-on"
                        className="absolute inset-0 rounded-xl bg-[rgb(168_224_195/9%)]"
                        transition={{ duration: 0.7, ease }}
                      />
                    ) : null}
                    <span className="relative min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">{model.name}</span>
                      <span className="block truncate text-[13.5px] text-[var(--soft)]">{model.note}</span>
                    </span>
                    <span
                      className={cn(
                        "relative flex size-6 items-center justify-center rounded-full border transition-colors duration-500",
                        on
                          ? "border-[var(--mint)] bg-[var(--mint)] text-[var(--mint-ink)]"
                          : "border-[var(--line-2)] text-transparent",
                      )}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div>
          <p className="px-2 pb-2 text-[12px] font-semibold tracking-[0.12em] text-[var(--faint)] uppercase">API key</p>
          <div className="flex flex-wrap gap-1.5 px-2 pb-1">
            {KEYS.map((key, i) => (
              <span
                key={key}
                className={cn("chip transition-colors duration-500", frame === 4 && i === 0 && "chip-mint")}
              >
                {key}
              </span>
            ))}
            <span className="chip border-dashed">and more</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- 2. A proposal you review ---- */

const CHANGES: {
  icon: LucideIcon;
  verb: string;
  text: string;
  meta: string;
}[] = [
  {
    icon: ListPlus,
    verb: "Add task",
    text: "Write the launch brief",
    meta: "1h 30m · Website refresh",
  },
  {
    icon: CalendarPlus,
    verb: "Add block",
    text: "Mon 10:45 – 12:15",
    meta: "Inside working hours",
  },
  {
    icon: MoveRight,
    verb: "Move",
    text: "Send October invoices",
    meta: "to Tue 09:00",
  },
  {
    icon: FilePlus2,
    verb: "Add doc",
    text: "Launch brief",
    meta: "in Website refresh",
  },
];
const PROPOSAL_MS = [1400, 750, 750, 750, 750, 1600, 2600] as const;

function Proposal() {
  const { ref, frame } = useFrames(7, PROPOSAL_MS, 5);
  const shown = Math.min(frame, CHANGES.length);
  const pressing = frame === 5;
  const applied = frame === 6;
  return (
    <div ref={ref} className="grid gap-3" aria-hidden>
      <div className="ml-auto max-w-[88%] rounded-[18px] rounded-br-md bg-[var(--panel-3)] px-4 py-2.5 text-[15px]">
        Fit the launch brief in before Tuesday and start a doc for it.
      </div>
      <div className="panel p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--mint)]">
            <Sparkles className="size-4" />
            {applied ? "Changes applied" : "Proposed changes"}
          </p>
          <span className="num text-[13px] text-[var(--faint)]">{shown} of 4</span>
        </div>
        <ul className="mt-3 grid">
          {CHANGES.map((change, i) => {
            const on = i < shown;
            return (
              <motion.li
                key={change.text}
                initial={false}
                animate={{ opacity: on ? 1 : 0.18, x: on ? 0 : -6 }}
                transition={{ duration: 0.5, ease }}
                className="flex items-center gap-3 border-t border-[var(--line)] py-2.5"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-500",
                    applied ? "bg-[var(--mint)] text-[var(--mint-ink)]" : "bg-[rgb(190_225_205/7%)] text-[var(--soft)]",
                  )}
                >
                  {applied ? <Check className="size-4" strokeWidth={2.6} /> : <change.icon className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 text-[14.5px] leading-snug">
                  <span className="text-[var(--faint)]">{change.verb} </span>
                  <span className="font-semibold">{change.text}</span>
                  <span className="block truncate text-[13px] text-[var(--soft)]">{change.meta}</span>
                </span>
              </motion.li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
          <motion.span
            animate={pressing ? { scale: [1, 0.95, 1] } : { scale: 1 }}
            transition={{ duration: 0.45, delay: 0.9 }}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors duration-500",
              applied ? "bg-[rgb(168_224_195/14%)] text-[var(--mint)]" : "bg-[var(--mint)] text-[var(--mint-ink)]",
            )}
          >
            {applied ? <Check className="size-4" /> : null}
            Apply changes
          </motion.span>
          <span className="inline-flex h-9 items-center rounded-full border border-[var(--line-2)] px-4 text-[14px] text-[var(--soft)]">
            Discard
          </span>
          <span className="ml-auto text-[13px] text-[var(--faint)]">
            {applied ? "Saved just now" : "Nothing is saved yet"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---- 3. Smart suggestions while you clarify ---- */

const FIELDS = [
  { label: "Length", value: "30m" },
  { label: "Project", value: "Website refresh" },
  { label: "Labels", value: "print · calls" },
  { label: "Due", value: "Wed 14 Oct" },
];
const CLARIFY_MS = [1300, 700, 700, 700, 700, 1500, 2400] as const;

function Clarify() {
  const { ref, frame } = useFrames(7, CLARIFY_MS, 6);
  const suggested = Math.min(frame, FIELDS.length);
  const accepted = frame >= 6;
  return (
    <div ref={ref} className="panel p-5 sm:p-6" aria-hidden>
      <p className="label">Clarify</p>
      <p className="mt-2 text-[19px] font-semibold leading-snug">Call the printer about launch posters</p>
      <div className="mt-4 inline-flex rounded-full border border-[var(--line-2)] p-1 text-[13.5px]">
        <span className="rounded-full bg-[var(--panel-3)] px-3.5 py-1 font-semibold">Work</span>
        <span className="px-3.5 py-1 text-[var(--soft)]">Reminder</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {FIELDS.map((field, i) => {
          const on = i < suggested;
          return (
            <div key={field.label} className="rounded-xl border border-[var(--line)] px-3.5 py-2.5">
              <dt className="text-[12.5px] text-[var(--faint)]">{field.label}</dt>
              <dd className="mt-1 flex h-7 items-center">
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.span
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5, ease }}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[14px] transition-colors duration-500",
                        accepted
                          ? "border-transparent bg-[rgb(190_225_205/8%)] text-[var(--ink)]"
                          : "border-dashed border-[rgb(168_224_195/45%)] text-[var(--mint)]",
                      )}
                    >
                      {accepted ? <Check className="size-3.5 text-[var(--mint)]" /> : <Sparkles className="size-3.5" />}
                      {field.value}
                    </motion.span>
                  ) : (
                    <span className="text-[14px] text-[var(--faint)]">—</span>
                  )}
                </AnimatePresence>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3 text-[13.5px]">
        <span className="text-[var(--faint)]">{accepted ? "4 suggestions accepted" : "Suggested from the words"}</span>
        <span className="rounded-full bg-[var(--mint)] px-4 py-1.5 font-semibold text-[var(--mint-ink)]">Save</span>
      </div>
    </div>
  );
}

/* ---- 4. Your own agents over MCP ---- */

const CLIENTS = ["Claude Code", "Codex", "Any MCP client"];
const CALLS = [
  { tool: "get_agenda", note: "3 events, 4 blocks today" },
  { tool: "what_next", note: "Write the launch brief, due Tue" },
  { tool: "create_task", note: "“Book the print shop”" },
  { tool: "auto_schedule_apply", note: "placed 2 blocks" },
];
const AGENT_MS = [1500, 1500, 1500, 2600] as const;
const X = [16.7, 50, 83.3];

function Agents() {
  const { ref, frame, calm } = useFrames(4, AGENT_MS, 3);
  const from = frame % 3;
  return (
    <div ref={ref} className="panel p-4 sm:p-6" aria-hidden>
      <div className="grid grid-cols-3 gap-2">
        {CLIENTS.map((client, i) => (
          <span
            key={client}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-[13.5px] leading-tight transition-colors duration-500",
              i === from && !calm
                ? "border-[rgb(168_224_195/40%)] text-[var(--ink)]"
                : "border-[var(--line)] text-[var(--soft)]",
            )}
          >
            <Bot className="hidden size-4 shrink-0 sm:block" />
            {client}
          </span>
        ))}
      </div>
      <div className="relative h-16">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          {X.map((x) => (
            <line
              key={x}
              x1={x}
              y1={0}
              x2={50}
              y2={100}
              stroke="rgb(190 225 205 / 22%)"
              strokeWidth="1"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {!calm ? (
          <motion.span
            key={frame}
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--mint)]"
            initial={{ left: `${X[from]}%`, top: "0%", opacity: 0 }}
            animate={{ left: "50%", top: "100%", opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: "linear" }}
          />
        ) : null}
      </div>
      <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl border border-[var(--line-2)] bg-[var(--panel-2)] px-4 py-3">
        <TimelyLogo size={24} tone="mono" className="text-[var(--mint)]" />
        <span>
          <span className="block text-[15px] font-semibold">Timely MCP server</span>
          <span className="block text-[13px] text-[var(--soft)]">150+ tools · personal key</span>
        </span>
      </div>
      <ul className="mt-5 grid gap-1 rounded-xl bg-[#07100d] p-3.5 font-mono text-[12.5px] leading-relaxed">
        {CALLS.map((call, i) => (
          <motion.li
            key={call.tool}
            initial={false}
            animate={{ opacity: i <= frame ? 1 : 0.2 }}
            transition={{ duration: 0.5 }}
            className="flex flex-wrap gap-x-3"
          >
            <span className="text-[var(--mint)]">→ {call.tool}</span>
            <span className="text-[var(--soft)]">{call.note}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/* ---- The four intervals of the AI session ---- */

const ROWS = [
  {
    stamp: "25:00",
    title: "Bring the subscription you already pay for",
    body: "Claude Code and Codex use the sign-in already on your computer, so chats run on your Claude or ChatGPT plan, with no extra API bill.",
    ticks: [
      "Or use OpenCode Go, local models through Ollama, or an API key for OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral and more.",
      "Switch the model per chat.",
    ],
    graphic: <ModelPicker />,
  },
  {
    stamp: "18:45",
    title: "It proposes. You decide.",
    body: "Ask for a plan in plain words. The assistant creates projects, tasks, events, docs and sheets, and bigger changes wait as a proposal for you to review.",
    ticks: ["Two buttons: Apply changes, or Discard.", "It keeps working in the background while you carry on."],
    graphic: <Proposal />,
  },
  {
    stamp: "12:30",
    title: "Suggestions while you clarify",
    body: "Type a rough thought into the Inbox. When you clarify it, Timely suggests the project, labels, length and dates from the words, and spots duplicates.",
    ticks: ["Nothing changes until you accept it.", "Without AI set up, Timely works exactly the same."],
    graphic: <Clarify />,
  },
  {
    stamp: "06:15",
    title: "Your own agents, connected over MCP",
    body: "Claude Code, Codex or any MCP client can connect to Timely's MCP server with a personal key, then read and plan your calendar, tasks, docs and sheets.",
    ticks: ["Deleting things needs the agent to confirm first.", "Revoke a key at any time."],
    graphic: <Agents />,
  },
];

export default function AiRows() {
  return (
    <div className="ai-rows">
      {ROWS.map((row) => (
        <article key={row.title} className="ai-row">
          <div>
            <p className="stamp num">
              <b>{row.stamp}</b>
              <span className="h-px w-8 bg-[var(--line-2)]" />
              remaining
            </p>
            <h3>{row.title}</h3>
            <p>{row.body}</p>
            <ul className="ticks">
              {row.ticks.map((tick) => (
                <li key={tick}>{tick}</li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">{row.graphic}</div>
        </article>
      ))}
    </div>
  );
}

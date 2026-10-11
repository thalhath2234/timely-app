"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  FileText,
  FolderKanban,
  KeyRound,
  ListChecks,
  Sparkles,
  Table2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import { useLoop, usePrefersReducedMotion } from "@/app/_components/site/motion";

const spring = { type: "spring", stiffness: 260, damping: 26 } as const;

/* ---- 1. Your own subscription: the same chat, whichever plan you sign in with ---- */

const PROVIDERS = [
  { name: "Claude Code", plan: "Your Claude Pro or Max plan", model: "Sonnet (latest)", mark: "C", color: "#f0a27a" },
  { name: "Codex", plan: "Your ChatGPT plan", model: "Codex default", mark: "◎", color: "#7cc4ff" },
  { name: "OpenCode Go", plan: "Your OpenCode Go subscription", model: "From your Go plan", mark: "Go", color: "#4edea3" },
  { name: "Ollama", plan: "Models on your own computer", model: "Local model", mark: "🦙", color: "#ecebf5" },
  { name: "OpenRouter", plan: "Hundreds of models, one key", model: "Any model you pick", mark: "OR", color: "#c0c1ff" },
];

function SubscriptionGraphic() {
  const { ref, frame } = useLoop(PROVIDERS.length, 1700, 0);
  const active = PROVIDERS[frame];
  return (
    <div ref={ref} className="grid h-full gap-4 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]" aria-hidden>
      <ul className="flex flex-col justify-center gap-1.5">
        {PROVIDERS.map((provider, index) => {
          const on = index === frame;
          return (
            <li
              key={provider.name}
              className={cn(
                "relative flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors duration-300",
                on ? "border-white/20 bg-white/[0.06]" : "border-white/[0.06] bg-white/[0.02]",
                index > 2 && "hidden sm:flex",
              )}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                style={{ color: provider.color, background: `color-mix(in oklch, ${provider.color} 14%, transparent)` }}
              >
                {provider.mark}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-white/90">{provider.name}</span>
                <span className="block truncate text-[10px] text-white/45">{provider.plan}</span>
              </span>
              <AnimatePresence>
                {on ? (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1 rounded-full bg-[#4edea3]/15 px-2 py-0.5 text-[9px] font-semibold text-[#4edea3]"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                    Connected
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>

      <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111319]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
            <TimelyLogo size={14} />
            Chat
          </span>
          <span className="relative flex h-6 items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04] pr-2 pl-2.5 text-[10px] text-white/70">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={active.model}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={spring}
                className="whitespace-nowrap"
              >
                {active.model}
              </motion.span>
            </AnimatePresence>
            <ChevronDown className="ml-1 size-3 text-white/40" />
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2 p-3.5">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#c0c1ff] px-3 py-1.5 text-[11px] font-medium text-[#1000a9]">
            What should I do next?
          </div>
          <motion.div
            key={frame}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-white/75"
          >
            Finish <span className="font-semibold text-white">Launch brief</span> first: it&apos;s due Friday and
            two tasks wait on it. You have a free 2-hour slot at 10:00.
          </motion.div>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-white/40">
            <span className="size-1.5 rounded-full" style={{ background: active.color }} />
            Running on {active.plan.charAt(0).toLowerCase() + active.plan.slice(1)}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- 2. The assistant: one request becomes a reviewed plan ---- */

const PLAN: { icon: LucideIcon; text: string }[] = [
  { icon: FolderKanban, text: "New project “Website launch”" },
  { icon: ListChecks, text: "8 tasks in 3 stages" },
  { icon: FileText, text: "Doc “Launch brief”" },
  { icon: Table2, text: "Sheet “Launch budget”" },
  { icon: CalendarDays, text: "6 blocks placed this week" },
];

function AssistantGraphic() {
  const { ref, frame } = useLoop(8, [1000, 650, 650, 650, 650, 650, 1500, 2000], 7);
  const shown = Math.max(0, Math.min(frame, PLAN.length));
  const applied = frame === 7;
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-2.5" aria-hidden>
      <div className="ml-auto max-w-[88%]">
        <div className="mb-1 flex justify-end gap-1">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] text-white/50">
            Workspace: Work
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] text-white/50">
            This week
          </span>
        </div>
        <div className="rounded-2xl rounded-br-md bg-[#c0c1ff] px-3 py-2 text-xs font-medium text-[#1000a9]">
          Plan the website launch for the end of the month, with a budget.
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-[#15171e] p-3.5">
        <p className="flex items-center justify-between gap-2 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5 text-[#c0c1ff]">
            <Sparkles className="size-3.5" />
            {applied ? "Applied" : "Needs your review"}
          </span>
          <span className="font-normal text-white/35">{shown} changes</span>
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {PLAN.map((step, index) => (
            <motion.li
              key={step.text}
              initial={false}
              animate={{ opacity: index < shown ? 1 : 0, x: index < shown ? 0 : -8 }}
              transition={spring}
              className="flex items-center gap-2 text-[11px] text-white/75"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors duration-300",
                  applied ? "bg-[#4edea3]/15 text-[#4edea3]" : "bg-white/[0.06] text-white/55",
                )}
              >
                {applied ? <Check className="size-3" strokeWidth={3} /> : <step.icon className="size-3" />}
              </span>
              {step.text}
            </motion.li>
          ))}
        </ul>
        <div className="mt-3 flex gap-1.5">
          <motion.span
            animate={applied ? { scale: [1, 0.94, 1] } : { scale: 1 }}
            transition={{ duration: 0.35 }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              applied ? "bg-[#4edea3] text-[#06281b]" : "bg-[#c0c1ff] text-[#1000a9]",
            )}
          >
            {applied ? <Check className="size-3" /> : null}
            {applied ? "Applied" : "Apply changes"}
          </motion.span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/55">Discard</span>
        </div>
      </div>
    </div>
  );
}

/* ---- 3. Smart suggestions: Clarify fills itself in from the words ---- */

const FIELDS = [
  { label: "Type", value: "Work" },
  { label: "Length", value: "2h" },
  { label: "Priority", value: "High" },
  { label: "Project", value: "Fundraising" },
  { label: "Labels", value: "writing" },
];

function SuggestionsGraphic() {
  const { ref, frame } = useLoop(8, [900, 500, 500, 500, 500, 500, 1400, 1900], 7);
  const filled = Math.min(frame, FIELDS.length);
  return (
    <div ref={ref} className="flex h-full items-center" aria-hidden>
      <div className="w-full rounded-2xl border border-white/10 bg-[#15171e] p-4">
        <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Clarify</p>
        <p className="mt-1.5 text-sm font-semibold text-white/90">Draft the Q3 investor update before Friday</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FIELDS.map((field, index) => {
            const on = index < filled;
            return (
              <div key={field.label} className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
                <p className="text-[9px] text-white/40">{field.label}</p>
                <div className="flex h-4 items-center gap-1">
                  <AnimatePresence>
                    {on ? (
                      <motion.span
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={spring}
                        className="flex items-center gap-1 text-[11px] font-medium text-white"
                      >
                        <Sparkles className="size-2.5 text-[#f0abfc]" />
                        {field.value}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </div>
                {index === filled - 1 && frame <= FIELDS.length ? <span className="s-shimmer absolute inset-0" /> : null}
              </div>
            );
          })}
        </div>
        <motion.div
          initial={false}
          animate={{ opacity: frame >= 6 ? 1 : 0, height: frame >= 6 ? "auto" : 0 }}
          transition={spring}
          className="overflow-hidden"
        >
          <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#ffb95f]/25 bg-[#ffb95f]/[0.07] px-2.5 py-1.5 text-[10px] text-[#ffd59e]">
            <Copy className="size-3" />
            Looks like “Investor update draft” already in Inbox
          </p>
        </motion.div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-white/35">Nothing changes until you save</span>
          <motion.span
            animate={frame === 7 ? { scale: [1, 0.94, 1] } : { scale: 1 }}
            transition={{ duration: 0.35 }}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              frame === 7 ? "bg-[#4edea3] text-[#06281b]" : "bg-[#c0c1ff] text-[#1000a9]",
            )}
          >
            {frame === 7 ? "Saved" : "Save"}
          </motion.span>
        </div>
      </div>
    </div>
  );
}

/* ---- 4. Your own agents: an MCP client drives Timely's tools ---- */

const CALLS = [
  { tool: "get_agenda", note: "3 events, 5 blocks today" },
  { tool: "what_next", note: "Launch brief, due Fri" },
  { tool: "create_task", note: "“Send deck to Sam”" },
  { tool: "auto_schedule_apply", note: "placed 2 blocks" },
];

function AgentsGraphic() {
  const { ref, frame } = useLoop(6, [900, 800, 800, 800, 1200, 1800], 5);
  const shown = Math.min(frame + 1, CALLS.length);
  return (
    <div ref={ref} className="flex h-full flex-col justify-center gap-3 sm:flex-row sm:items-center" aria-hidden>
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#08090c] p-3.5 font-mono sm:flex-1">
        <p className="flex items-center gap-1.5 text-[10px] text-white/40">
          <Bot className="size-3.5" />
          your-agent · mcp
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {CALLS.map((call, index) => (
            <motion.li
              key={call.tool}
              initial={false}
              animate={{ opacity: index < shown ? 1 : 0, y: index < shown ? 0 : 6 }}
              transition={spring}
              className="text-[10.5px] leading-snug"
            >
              <span className="text-[#c0c1ff]">→ {call.tool}</span>
              <span className="block pl-3 text-white/45">{call.note}</span>
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="relative flex h-10 items-center justify-center sm:h-auto sm:w-16">
        <div className="absolute h-full w-px bg-white/10 sm:h-px sm:w-full" />
        <motion.span
          key={frame}
          className="absolute size-2 rounded-full bg-[#c0c1ff] shadow-[0_0_12px_#c0c1ff]"
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.8 }}
        />
        <span className="relative flex items-center gap-1 rounded-full border border-white/10 bg-[#15171e] px-2 py-0.5 text-[9px] text-white/55">
          <KeyRound className="size-2.5" />
          key
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="relative flex size-20 items-center justify-center rounded-3xl border border-white/10 bg-[#15171e] shadow-[0_0_50px_-8px_rgba(192,193,255,0.6)]">
          <div className="s-spin-slow absolute inset-[-10px] rounded-[30px] border border-dashed border-white/10" />
          <TimelyLogo size={38} />
        </div>
        <p className="text-[10px] text-white/45">150+ tools</p>
      </div>
    </div>
  );
}

/* ---- The showcase: tabs that advance on their own while on screen ---- */

const TABS: {
  id: string;
  icon: LucideIcon;
  title: string;
  line: string;
  points: string[];
  graphic: () => React.ReactNode;
}[] = [
  {
    id: "subscriptions",
    icon: KeyRound,
    title: "Use the subscription you already have",
    line: "Sign in with Claude or ChatGPT. No extra API bill.",
    points: [
      "Claude Code and Codex use the sign-in on your computer, so chats run on your Claude or ChatGPT plan.",
      "Or use OpenCode Go, local models through Ollama, or a key for OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral and more.",
      "Switch the model per chat. Timely never switches provider behind your back.",
    ],
    graphic: () => <SubscriptionGraphic />,
  },
  {
    id: "assistant",
    icon: Wand2,
    title: "An assistant that does the work",
    line: "Ask for a plan. Review it. Approve it.",
    points: [
      "Creates projects, tasks, events, docs and sheets, and places Work on your calendar.",
      "Sees what you have open, and bigger changes wait for your review before anything is written.",
      "Keeps working in the Activity island while you carry on. Snap a receipt and it fills your expense sheet.",
    ],
    graphic: () => <AssistantGraphic />,
  },
  {
    id: "suggestions",
    icon: Sparkles,
    title: "Smart suggestions everywhere",
    line: "Type a thought; the details fill themselves in.",
    points: [
      "Clarify suggests type, length, priority, project and labels from the words, and spots duplicates.",
      "Hints across search, tasks, docs and Today: better ordering, stale work, where a doc belongs.",
      "Nothing changes until you accept it. Without a key, Timely works exactly the same.",
    ],
    graphic: () => <SuggestionsGraphic />,
  },
  {
    id: "agents",
    icon: Bot,
    title: "Plug in your own AI agents",
    line: "A built-in MCP server with more than 150 tools.",
    points: [
      "Give any MCP agent a personal key and it can read and plan your calendar, tasks, docs and sheets.",
      "Deleting things or restoring a backup needs the agent to confirm first. Revoke a key at any time.",
      "In the desktop app the server runs on your computer, reachable over your own Tailscale network.",
    ],
    graphic: () => <AgentsGraphic />,
  },
];

const TAB_MS = 8000;

export default function AiShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const playing = inView && !reduced;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setIndex((value) => (value + 1) % TABS.length);
      setRound((value) => value + 1);
    }, TAB_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, round]);

  // On phones the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    const list = listRef.current;
    const button = list?.children[index] as HTMLElement | undefined;
    if (!list || !button || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: button.offsetLeft - 16, behavior: reduced ? "auto" : "smooth" });
  }, [index, reduced]);

  const select = (next: number) => {
    setIndex(next);
    setRound((value) => value + 1);
  };

  const tab = TABS[index];

  return (
    <div ref={ref} className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-8">
      <div ref={listRef} role="tablist" aria-label="AI in Timely" className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {TABS.map((item, itemIndex) => {
          const on = itemIndex === index;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`ai-tab-${item.id}`}
              aria-selected={on}
              aria-controls="ai-panel"
              onClick={() => select(itemIndex)}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-2xl border text-left transition-colors duration-300",
                "px-3.5 py-2.5 lg:px-5 lg:py-4",
                on ? "border-white/15 bg-[#15171e]" : "border-transparent bg-white/[0.02] hover:bg-white/[0.04]",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                    on ? "bg-[#c0c1ff]/15 text-[var(--s-primary)]" : "bg-white/[0.04] text-white/45",
                  )}
                >
                  <item.icon className="size-4" />
                </span>
                <span className={cn("text-sm font-semibold whitespace-nowrap lg:whitespace-normal", on ? "text-[var(--s-ink)]" : "text-white/60")}>
                  {item.title}
                </span>
              </span>
              <AnimatePresence initial={false}>
                {on ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="hidden overflow-hidden lg:block"
                  >
                    <ul className="mt-3 space-y-2 pl-[2.6rem] text-sm leading-relaxed text-[var(--s-soft)]">
                      {item.points.map((point) => (
                        <li key={point} className="relative before:absolute before:top-[0.6em] before:-left-3 before:size-1 before:rounded-full before:bg-white/25">
                          {point}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {on && playing ? (
                <motion.span
                  key={round}
                  aria-hidden
                  className="absolute bottom-0 left-0 h-0.5 bg-[var(--s-primary)]"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: TAB_MS / 1000, ease: "linear" }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div id="ai-panel" role="tabpanel" aria-labelledby={`ai-tab-${tab.id}`}>
        <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#0e1015] p-4 sm:p-6">
          <div aria-hidden className="s-orb top-[-30%] right-[-10%] size-[320px] bg-[#6f6ff0] opacity-30" />
          <div aria-hidden className="s-orb bottom-[-40%] left-[-10%] size-[300px] bg-[#c26bf0] opacity-20" style={{ animationDelay: "-5s" }} />
          <p className="relative text-center text-xs font-medium text-white/45 lg:hidden">{tab.line}</p>
          <div className="relative mt-4 h-[440px] sm:h-[360px] lg:mt-0 lg:h-[400px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${tab.id}-${round}`}
                className="h-full"
                initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                {tab.graphic()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <ul className="mt-4 space-y-2 px-1 text-sm leading-relaxed text-[var(--s-soft)] lg:hidden">
          {tab.points.map((point) => (
            <li key={point} className="flex gap-2">
              <Check className="mt-1 size-3.5 shrink-0 text-[var(--s-primary)]" />
              {point}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

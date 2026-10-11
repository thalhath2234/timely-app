"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { C, type ColorName } from "./data";
import { useReduced, useSteps } from "./kinetic";

const ease = [0.7, 0, 0.2, 1] as const;

/* ---- 1.1 Your own subscription: a timetable of providers, one lit at a time ---- */

const PROVIDERS: { name: string; how: string; runs: string; color: ColorName }[] = [
  { name: "Claude Code", how: "Sign-in", runs: "your Claude plan", color: "orange" },
  { name: "Codex", how: "Sign-in", runs: "your ChatGPT plan", color: "cyan" },
  { name: "OpenCode Go", how: "Subscription", runs: "your OpenCode Go plan", color: "green" },
  { name: "Ollama", how: "Local", runs: "models on this computer", color: "amber" },
  { name: "OpenRouter", how: "API key", runs: "an OpenRouter key", color: "violet" },
  { name: "Anthropic", how: "API key", runs: "an Anthropic key", color: "pink" },
  { name: "OpenAI", how: "API key", runs: "an OpenAI key", color: "blue" },
  { name: "Gemini", how: "API key", runs: "a Gemini key", color: "blue" },
  { name: "DeepSeek", how: "API key", runs: "a DeepSeek key", color: "violet" },
  { name: "xAI", how: "API key", runs: "an xAI key", color: "pink" },
  { name: "Mistral", how: "API key", runs: "a Mistral key", color: "orange" },
  { name: "and more", how: "API key", runs: "your key", color: "green" },
];

const CYCLE = [0, 1, 3, 2, 4, 6, 7, 10];
const CYCLE_MS = CYCLE.map(() => 1500);

export function ProviderGraphic() {
  const { ref, frame } = useSteps(CYCLE_MS, 0);
  const lit = CYCLE[frame];
  const provider = PROVIDERS[lit];
  return (
    <div ref={ref} aria-hidden className="select-none">
      <div className="flex items-center justify-between gap-3 border border-[var(--line-2)] bg-[var(--panel)] px-3 py-2.5 sm:px-4">
        <span className="min-w-0 truncate text-sm font-semibold">Chat · Plan the launch week</span>
        <span className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border border-[var(--line-2)] px-2.5 text-xs">
          <span className="d4-label text-[10px] text-[var(--faint)]">Model</span>
          <span className="relative h-4 w-[92px] overflow-hidden sm:w-[110px]">
            <AnimatePresence initial={false}>
              <motion.span
                key={provider.name}
                className="absolute inset-0 truncate font-semibold"
                initial={{ y: 18 }}
                animate={{ y: 0 }}
                exit={{ y: -18 }}
                transition={{ duration: 0.4, ease }}
              >
                {provider.name}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 border-l border-[var(--line-2)] sm:grid-cols-3 lg:grid-cols-4">
        {PROVIDERS.map((item, index) => {
          const on = index === lit;
          return (
            <div key={item.name} className="relative h-[74px] overflow-hidden border-r border-b border-[var(--line-2)] px-3 py-2.5 sm:h-[84px]">
              <motion.span
                className="absolute inset-0"
                style={{ background: C[item.color].bg, originX: 0 }}
                initial={false}
                animate={{ scaleX: on ? 1 : 0 }}
                transition={{ duration: 0.45, ease }}
              />
              <span className="relative flex h-full flex-col justify-between" style={{ color: on ? C[item.color].ink : undefined }}>
                <span className={cn("d4-label text-[10px] transition-colors", on ? "" : "text-[var(--faint)]")}>{item.how}</span>
                <span className="text-[17px] leading-none font-bold tracking-[-0.03em] sm:text-lg">{item.name}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-[var(--soft)]">
        This chat runs on <span className="font-semibold text-[var(--ink)]">{provider.runs}</span>. The next one can use another.
      </p>
    </div>
  );
}

/* ---- 1.2 The assistant proposes; you choose Apply changes or Discard ---- */

const CHANGES = [
  { n: "01", text: "New project “Website launch”" },
  { n: "02", text: "8 tasks in 3 stages" },
  { n: "03", text: "Doc “Launch brief”" },
  { n: "04", text: "Sheet “Launch budget”" },
  { n: "05", text: "6 blocks placed this week" },
];

const PROPOSED = [
  { day: 0, from: 0.1, to: 0.45 },
  { day: 1, from: 0.55, to: 0.85 },
  { day: 2, from: 0.05, to: 0.3 },
  { day: 2, from: 0.6, to: 0.95 },
  { day: 3, from: 0.3, to: 0.6 },
  { day: 4, from: 0.1, to: 0.35 },
];

const REVIEW_MS = [1200, 550, 550, 550, 550, 900, 700, 2600];

export function ReviewGraphic() {
  const { ref, frame } = useSteps(REVIEW_MS);
  const shown = Math.min(Math.max(frame, 0), CHANGES.length);
  const pressing = frame === 6;
  const applied = frame === 7;
  return (
    <div ref={ref} aria-hidden className="grid select-none border border-[var(--line-2)] bg-[var(--panel)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="ml-auto max-w-[88%] bg-[var(--ink)] px-3.5 py-2.5 text-[13px] leading-snug font-medium text-[#0a0a0a]">
          Plan the website launch for the end of the month, with a budget.
        </div>
        <div className="border border-[var(--line-2)] bg-[var(--bg)]">
          <p className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2 text-[12px]">
            <span className="font-semibold">{applied ? "Applied" : "Needs your review"}</span>
            <span className="d4-mono text-[var(--faint)]">{shown} changes</span>
          </p>
          <ul>
            {CHANGES.map((change, index) => (
              <li key={change.n} className="relative flex h-8 items-center gap-3 overflow-hidden border-b border-[var(--line)] px-3.5 text-[12.5px]">
                <motion.span
                  className="flex items-center gap-3"
                  initial={false}
                  animate={{ x: index < shown ? 0 : "-110%", opacity: index < shown ? 1 : 0 }}
                  transition={{ duration: 0.45, ease }}
                >
                  <span
                    className="d4-mono flex h-5 w-6 items-center justify-center text-[10px] font-semibold transition-colors duration-300"
                    style={applied ? { background: C.green.bg, color: C.green.ink } : { background: "rgb(243 242 237 / 10%)" }}
                  >
                    {applied ? "✓" : change.n}
                  </span>
                  {change.text}
                </motion.span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 px-3.5 py-3">
            <motion.span
              animate={{ scale: pressing ? 0.94 : 1 }}
              transition={{ duration: 0.18 }}
              className="inline-flex h-8 items-center px-3 text-[12.5px] font-semibold transition-colors duration-300"
              style={applied ? { background: C.green.bg, color: C.green.ink } : { background: "var(--ink)", color: "#0a0a0a" }}
            >
              {applied ? "Applied" : "Apply changes"}
            </motion.span>
            <span className="inline-flex h-8 items-center border border-[var(--line-2)] px-3 text-[12.5px] text-[var(--soft)]">Discard</span>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--line-2)] p-4 sm:p-5 md:border-t-0 md:border-l">
        <p className="d4-label text-[10px] text-[var(--faint)]">This week · preview</p>
        <div className="relative mt-3 grid h-[180px] grid-cols-5 border-t border-l border-[var(--line)] md:h-[calc(100%-28px)] md:min-h-[230px]">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
            <span key={day} className="border-r border-b border-[var(--line)] p-1.5 text-[10px] font-semibold text-[var(--faint)]">
              {day}
            </span>
          ))}
          {PROPOSED.map((block, index) => {
            const on = index < (shown >= 5 ? 6 : shown);
            return (
              <motion.span
                key={index}
                className="absolute overflow-hidden"
                style={{
                  left: `calc(${block.day} * 20% + 3px)`,
                  width: "calc(20% - 6px)",
                  top: `calc(22px + ${block.from} * (100% - 26px))`,
                  height: `calc(${block.to - block.from} * (100% - 26px))`,
                  outline: "1.5px dashed var(--line-2)",
                  outlineOffset: "-1.5px",
                }}
                initial={false}
                animate={{ opacity: on ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.span
                  className="absolute inset-0"
                  style={{ background: C.violet.bg, originY: 0 }}
                  initial={false}
                  animate={{ scaleY: applied ? 1 : 0 }}
                  transition={{ duration: 0.5, delay: applied ? index * 0.07 : 0, ease }}
                />
              </motion.span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---- 1.3 Smart suggestions: Clarify fills in its own fields ---- */

const FIELDS: { label: string; value: string; color?: ColorName }[] = [
  { label: "Type", value: "Work" },
  { label: "Length", value: "2h" },
  { label: "Priority", value: "High" },
  { label: "Project", value: "Fundraising", color: "green" },
  { label: "Labels", value: "writing" },
  { label: "Deadline", value: "Fri 16 Oct" },
];

const SUGGEST_MS = [1100, 450, 450, 450, 450, 450, 450, 900, 2400];

export function SuggestGraphic() {
  const { ref, frame } = useSteps(SUGGEST_MS);
  const filled = Math.min(frame, FIELDS.length);
  const saved = frame === SUGGEST_MS.length - 1;
  return (
    <div ref={ref} aria-hidden className="select-none border border-[var(--line-2)] bg-[var(--panel)]">
      <div className="border-b border-[var(--line-2)] px-4 py-3">
        <p className="d4-label text-[10px] text-[var(--faint)]">Clarify · Inbox 1 of 4</p>
        <p className="mt-1 text-[15px] leading-snug font-semibold tracking-[-0.02em]">Draft the Q3 investor update before Friday</p>
      </div>
      <dl className="grid grid-cols-2">
        {FIELDS.map((field, index) => {
          const on = index < filled;
          return (
            <div key={field.label} className={cn("relative h-14 overflow-hidden border-b border-[var(--line)] px-4 py-2", index % 2 === 0 && "border-r")}>
              <dt className="text-[10.5px] text-[var(--faint)]">{field.label}</dt>
              <dd className="relative mt-0.5 h-5">
                <motion.span
                  className="absolute inset-0 flex items-center gap-1.5 text-[13.5px] font-semibold"
                  initial={false}
                  animate={{ y: on ? 0 : 24 }}
                  transition={{ duration: 0.4, ease }}
                >
                  {field.color ? <span className="size-2.5" style={{ background: C[field.color].bg }} /> : null}
                  {field.value}
                </motion.span>
              </dd>
              {on ? <span className="absolute top-2.5 right-3 size-1.5 bg-[var(--amber)]" title="Suggested" /> : null}
            </div>
          );
        })}
      </dl>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-[11.5px] text-[var(--soft)]">
          <span className="size-1.5 bg-[var(--amber)]" />
          Suggested · nothing changes until you save
        </span>
        <span
          className="inline-flex h-8 items-center px-3.5 text-[12.5px] font-semibold transition-colors duration-300"
          style={saved ? { background: C.green.bg, color: C.green.ink } : { background: "var(--ink)", color: "#0a0a0a" }}
        >
          {saved ? "Saved" : "Save"}
        </span>
      </div>
    </div>
  );
}

/* ---- 1.4 Your own agents over MCP ---- */

const CLIENTS = ["Claude Code", "Codex", "Any MCP client"];
const TARGETS: { name: string; color: ColorName }[] = [
  { name: "Calendar", color: "violet" },
  { name: "Tasks", color: "amber" },
  { name: "Docs", color: "blue" },
  { name: "Sheets", color: "green" },
];
const CALLS = [
  { client: 0, target: 0, call: "get_agenda", note: "3 events, 5 blocks today" },
  { client: 1, target: 1, call: "create_task", note: "“Send deck to Sam”" },
  { client: 2, target: 3, call: "add_sheet_rows", note: "Launch budget +1 row" },
  { client: 0, target: 0, call: "auto_schedule_apply", note: "placed 2 blocks" },
  { client: 1, target: 2, call: "append_to_doc", note: "Launch brief" },
];
const MCP_MS = CALLS.map(() => 1900);

export function McpGraphic() {
  const { ref, frame } = useSteps(MCP_MS, 3);
  const reduced = useReduced();
  const call = CALLS[frame];
  const rowY = (index: number, count: number) => 20 + (index * 160) / (count - 1);
  const fromY = rowY(call.client, CLIENTS.length);
  const toY = rowY(call.target, TARGETS.length);
  return (
    <div ref={ref} aria-hidden className="select-none border border-[var(--line-2)] bg-[var(--panel)] p-4">
      <svg viewBox="0 0 400 200" className="block w-full overflow-visible">
        {CLIENTS.map((client, index) => {
          const y = rowY(index, CLIENTS.length);
          const on = index === call.client;
          return (
            <g key={client}>
              <line x1="112" y1={y} x2="168" y2="100" stroke="rgb(243 242 237 / 0.3)" strokeWidth="1" className={on ? "d4-march" : undefined} />
              <rect x="0" y={y - 14} width="112" height="28" fill={on ? "#f3f2ed" : "transparent"} stroke="rgb(243 242 237 / 0.34)" />
              <text x="9" y={y + 4.5} fontSize="12.5" fontWeight="650" fill={on ? "#0a0a0a" : "#f3f2ed"}>
                {client}
              </text>
            </g>
          );
        })}
        {TARGETS.map((target, index) => {
          const y = rowY(index, TARGETS.length);
          const on = index === call.target;
          return (
            <g key={target.name}>
              <line x1="232" y1="100" x2="300" y2={y} stroke="rgb(243 242 237 / 0.3)" strokeWidth="1" className={on ? "d4-march" : undefined} />
              <rect x="300" y={y - 13} width="100" height="26" fill={on ? C[target.color].bg : "transparent"} stroke={on ? C[target.color].bg : "rgb(243 242 237 / 0.34)"} />
              <text x="309" y={y + 4.5} fontSize="12.5" fontWeight="650" fill={on ? C[target.color].ink : "#f3f2ed"}>
                {target.name}
              </text>
            </g>
          );
        })}
        <rect x="168" y="62" width="64" height="76" fill="#f3f2ed" />
        <text x="200" y="94" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0a0a0a" letterSpacing="-0.5">
          MCP
        </text>
        <text x="200" y="112" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#0a0a0a">
          Timely
        </text>
        {reduced ? null : (
          <motion.rect
            key={frame}
            width="8"
            height="8"
            fill="#ffb224"
            initial={{ x: 108, y: fromY - 4 }}
            animate={{ x: [108, 164, 228, 296], y: [fromY - 4, 96, 96, toY - 4] }}
            transition={{ duration: 1.2, times: [0, 0.35, 0.6, 1], ease: "easeInOut" }}
          />
        )}
      </svg>
      <div className="d4-mono mt-3 flex h-10 items-center gap-2 overflow-hidden border-t border-[var(--line)] pt-3 text-[12px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={call.call}
            className="flex min-w-0 items-center gap-2"
            initial={{ y: 20 }}
            animate={{ y: 0 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <span className="text-[var(--amber)]">→ {call.call}</span>
            <span className="truncate text-[var(--soft)]">{call.note}</span>
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "./hooks";
import { Tick } from "./ink";

const spring = { type: "spring", stiffness: 260, damping: 28 } as const;

/* ---- Search: Ctrl/Cmd+K, a word, and everything that matches ---- */

const RESULTS = [
  { kind: "Task", title: "Write the launch brief", meta: "Website launch · due Tue" },
  { kind: "Doc", title: "Launch plan", meta: "Website launch" },
  { kind: "Sheet", title: "Launch budget", meta: "€516.80" },
  { kind: "Event", title: "Client review", meta: "Tue 10:00" },
];
const QUERY = ["", "la", "laun", "launch", "launch", "launch"];

export function FigSearch() {
  const { ref, frame } = useLoop(6, [1000, 380, 380, 600, 900, 2800], 5);
  const pressed = frame === 0;
  const shown = frame >= 4 ? RESULTS.length : frame >= 3 ? 2 : 0;
  return (
    <div ref={ref} aria-hidden className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        {["Ctrl", "K"].map((key, index) => (
          <motion.kbd
            key={key}
            initial={false}
            animate={pressed ? { y: [0, 3, 0] } : { y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.08 }}
            className="d2-mono inline-flex h-8 min-w-8 items-center justify-center border border-b-[3px] border-[var(--rule-3)] bg-[var(--paper-3)] px-2 text-[12px]"
          >
            {key}
          </motion.kbd>
        ))}
        <span className="d2-faint text-[12px]">Cmd+K works too</span>
      </div>
      <div className="flex-1 border border-[var(--rule-2)] bg-[var(--sheet)]">
        <p className="flex h-9 items-center gap-2 border-b border-[var(--rule-2)] px-3 text-[13px]">
          <span className="d2-faint">⌕</span>
          <span>{QUERY[frame]}</span>
          <span className="d2-caret -ml-1.5" />
        </p>
        <ul className="px-1 py-1">
          {RESULTS.map((result, index) => (
            <motion.li
              key={result.title}
              initial={false}
              animate={{ opacity: index < shown ? 1 : 0, x: index < shown ? 0 : -6 }}
              transition={{ ...spring, delay: index < shown ? index * 0.06 : 0 }}
              className={cn("flex items-baseline gap-3 px-2 py-[5px] text-[12.5px]", index === 0 && "bg-[var(--verm-wash)]")}
            >
              <span className="d2-mono w-10 shrink-0 text-[9.5px] text-[var(--verm-2)] uppercase">{result.kind}</span>
              <span className="truncate">{result.title}</span>
              <span className="d2-faint ml-auto hidden shrink-0 text-[11px] sm:inline">{result.meta}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---- Dashboard: cards you drag and resize ---- */

const CARDS = [
  { id: "focus", label: "Focus time", value: "3h 20m", note: "this week" },
  { id: "pomo", label: "Pomodoro", value: "25:00", note: "ready" },
  { id: "journal", label: "Journal", value: "Sun 11 Oct", note: "" },
  { id: "dead", label: "Deadlines", value: "3", note: "this week" },
];
const LAYOUTS = [
  { order: ["focus", "pomo", "journal", "dead"], wide: ["focus", "dead"] },
  { order: ["pomo", "focus", "journal", "dead"], wide: ["focus", "journal"] },
  { order: ["journal", "dead", "focus", "pomo"], wide: ["journal", "pomo"] },
];

export function FigDashboard() {
  const { ref, frame } = useLoop(LAYOUTS.length, 2600, 0);
  const layout = LAYOUTS[frame];
  const cards = layout.order.map((id) => CARDS.find((card) => card.id === id)!);
  return (
    <div ref={ref} aria-hidden className="grid h-full grid-cols-3 grid-rows-2 gap-2">
      {cards.map((card) => {
        const wide = layout.wide.includes(card.id);
        return (
          <motion.div
            key={card.id}
            layout
            transition={spring}
            className={cn("relative flex flex-col justify-between border border-[var(--rule-2)] bg-[var(--sheet)] p-2.5", wide && "col-span-2")}
          >
            <motion.p layout="position" className="d2-mono text-[9.5px] tracking-wider text-[var(--ink-3)] uppercase">
              {card.label}
            </motion.p>
            <motion.p layout="position" className="d2-serif text-[1.35rem] leading-none">
              {card.value}
              <span className="d2-faint ml-1.5 font-sans text-[10px]">{card.note}</span>
            </motion.p>
            <span className="absolute right-1 bottom-1 size-2 border-r border-b border-[var(--ink-3)]" />
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Habits and goals: ticks through the week ---- */

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function FigHabits() {
  const { ref, frame } = useLoop(9, [700, 380, 380, 380, 380, 380, 380, 600, 2600], 8);
  const ticked = Math.min(frame, 7);
  return (
    <div ref={ref} aria-hidden className="flex h-full flex-col justify-around border border-[var(--rule-2)] bg-[var(--sheet)] p-3">
      <div>
        <p className="flex items-baseline justify-between text-[13px]">
          <span>Morning walk</span>
          <span className="d2-mono text-[10.5px] text-[var(--verm-2)]">{12 + ticked} day streak</span>
        </p>
        <ol className="mt-2 grid grid-cols-7 gap-1">
          {DAYS.map((day, index) => (
            <li key={index} className="relative flex h-9 flex-col items-center justify-end border border-[var(--rule-2)] pb-0.5">
              <span className="d2-mono text-[9px] text-[var(--ink-3)]">{day}</span>
              <Tick on={index < ticked} className="absolute top-0.5 left-1/2 h-4 w-5 -translate-x-1/2" />
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="flex items-baseline justify-between text-[13px]">
          <span>Read 12 books</span>
          <span className="d2-mono text-[10.5px] text-[var(--ink-2)]">{frame >= 8 ? 8 : 7} / 12</span>
        </p>
        <div className="mt-1.5 h-2 border border-[var(--rule-3)] p-px">
          <motion.div initial={false} animate={{ width: frame >= 8 ? "66.6%" : "58.3%" }} transition={spring} className="h-full bg-[var(--ink-2)]" />
        </div>
      </div>
    </div>
  );
}

/* ---- Calendar views: Day, Week, Month, Agenda ---- */

const VIEWS = ["Day", "Week", "Month", "Agenda"];

function ViewDrawing({ view }: { view: string }) {
  if (view === "Day") {
    return (
      <div className="relative h-full border-l border-[var(--rule-2)] ml-6">
        {[10, 34, 58, 82].map((top) => (
          <span key={top} className="absolute inset-x-0 border-t border-[var(--rule)]" style={{ top: `${top}%` }} />
        ))}
        <span className="absolute top-[12%] right-2 left-2 h-[18%] bg-[var(--ink)]" />
        <span className="d2-hatch absolute top-[38%] right-2 left-2 h-[16%] border border-[var(--rule-3)]" />
        <span className="absolute top-[62%] right-2 left-2 h-[24%] bg-[var(--ink-2)]" />
      </div>
    );
  }
  if (view === "Week") {
    return (
      <div className="grid h-full grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, day) => (
          <div key={day} className="relative border-l border-[var(--rule)]">
            <span className="absolute inset-x-0.5 bg-[var(--ink)]" style={{ top: `${10 + ((day * 23) % 40)}%`, height: `${18 + ((day * 11) % 20)}%` }} />
            {day % 2 ? <span className="d2-hatch absolute inset-x-0.5 border border-[var(--rule-3)]" style={{ top: "66%", height: "18%" }} /> : null}
          </div>
        ))}
      </div>
    );
  }
  if (view === "Month") {
    return (
      <div className="grid h-full grid-cols-7 grid-rows-5 border-t border-l border-[var(--rule)]">
        {Array.from({ length: 35 }, (_, cell) => (
          <div key={cell} className="relative border-r border-b border-[var(--rule)]">
            {cell % 3 === 0 ? <span className="absolute inset-x-1 top-1 h-[3px] bg-[var(--ink-2)]" /> : null}
            {cell === 11 ? <span className="absolute inset-0 border border-[var(--verm)]" /> : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-[11px]">
      {[
        ["Mon 09:00", "Weekly planning"],
        ["Mon 10:00", "Write the launch brief"],
        ["Mon 12:00", "Lunch with Sam"],
        ["Tue 10:00", "Client review"],
      ].map(([time, title]) => (
        <li key={time} className="flex gap-2 border-b border-dotted border-[var(--rule-2)] pb-1">
          <span className="d2-mono w-16 shrink-0 text-[var(--ink-3)]">{time}</span>
          <span className="truncate">{title}</span>
        </li>
      ))}
    </ul>
  );
}

export function FigViews() {
  const { ref, frame } = useLoop(VIEWS.length, 1900, 1);
  const view = VIEWS[frame];
  return (
    <div ref={ref} aria-hidden className="flex h-full flex-col border border-[var(--rule-2)] bg-[var(--sheet)] p-3">
      <div className="flex border-b border-[var(--rule-2)]">
        {VIEWS.map((item) => (
          <span key={item} className={cn("relative px-2 pb-1.5 text-[11.5px] transition-colors", item === view ? "text-[var(--ink)]" : "text-[var(--ink-3)]")}>
            {item}
            {item === view ? <motion.span layoutId="d2-view-tab" className="absolute inset-x-1 -bottom-px h-[2px] bg-[var(--verm)]" /> : null}
          </span>
        ))}
      </div>
      <div className="relative mt-2.5 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, clipPath: "inset(0% 100% 0% 0%)" }}
            animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0"
          >
            <ViewDrawing view={view} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---- Tasks: the same four tasks as a list, a board and a Gantt chart ---- */

const TASKS = ["Brief", "Wireframes", "Copy", "Deploy"];
const TASK_VIEWS = ["List", "Board", "Gantt"] as const;
type Box = { left: string; top: string; width: string; height: string };
const BOXES: Record<(typeof TASK_VIEWS)[number], Box[]> = {
  List: TASKS.map((_, index) => ({ left: "0%", top: `${index * 25}%`, width: "100%", height: "21%" })),
  Board: [
    { left: "0%", top: "0%", width: "31.5%", height: "30%" },
    { left: "34.2%", top: "0%", width: "31.5%", height: "30%" },
    { left: "34.2%", top: "35%", width: "31.5%", height: "30%" },
    { left: "68.5%", top: "0%", width: "31.5%", height: "30%" },
  ],
  Gantt: [
    { left: "0%", top: "2%", width: "28%", height: "17%" },
    { left: "22%", top: "27%", width: "34%", height: "17%" },
    { left: "48%", top: "52%", width: "30%", height: "17%" },
    { left: "76%", top: "77%", width: "24%", height: "17%" },
  ],
};

export function FigTasks() {
  const { ref, frame } = useLoop(3, 2300, 0);
  const view = TASK_VIEWS[frame];
  return (
    <div ref={ref} aria-hidden className="flex h-full flex-col border border-[var(--rule-2)] bg-[var(--sheet)] p-3">
      <div className="flex border-b border-[var(--rule-2)]">
        {TASK_VIEWS.map((item) => (
          <span key={item} className={cn("relative px-2 pb-1.5 text-[11.5px]", item === view ? "text-[var(--ink)]" : "text-[var(--ink-3)]")}>
            {item}
            {item === view ? <motion.span layoutId="d2-task-tab" className="absolute inset-x-1 -bottom-px h-[2px] bg-[var(--verm)]" /> : null}
          </span>
        ))}
      </div>
      <div className="relative mt-3 flex-1">
        {TASKS.map((task, index) => (
          <motion.span
            key={task}
            initial={false}
            animate={BOXES[view][index]}
            transition={{ ...spring, delay: index * 0.04 }}
            className={cn(
              "absolute flex items-center overflow-hidden px-2 text-[11px] whitespace-nowrap",
              view === "Gantt" ? "bg-[var(--ink)] text-[var(--paper)]" : "border border-[var(--rule-3)]",
            )}
          >
            {view === "List" ? <span className="mr-2 size-2.5 shrink-0 border border-[var(--ink-3)]" /> : null}
            {task}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

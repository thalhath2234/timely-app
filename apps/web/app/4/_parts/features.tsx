"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { C, type ColorName } from "./data";
import { useSteps } from "./kinetic";

const ease = [0.7, 0, 0.2, 1] as const;

/* ---- Tasks: the same five tasks as a list, a board and a Gantt chart ---- */

const TASKS: { title: string; color: ColorName; status: 0 | 1 | 2; start: number; length: number }[] = [
  { title: "Write the launch brief", color: "violet", status: 1, start: 0, length: 0.3 },
  { title: "Build the launch budget", color: "blue", status: 0, start: 0.22, length: 0.22 },
  { title: "Design the homepage", color: "violet", status: 1, start: 0.3, length: 0.45 },
  { title: "Book the moving van", color: "green", status: 2, start: 0.05, length: 0.1 },
  { title: "Test the contact form", color: "cyan", status: 0, start: 0.7, length: 0.28 },
];
const STATUSES = ["To do", "Doing", "Done"];
const MODES = ["List", "Board", "Gantt"] as const;

function place(mode: (typeof MODES)[number], index: number) {
  const task = TASKS[index];
  if (mode === "List") return { left: "0%", top: `${index * 19}%`, width: "100%", height: "16%" };
  if (mode === "Board") {
    const column = task.status;
    const row = TASKS.slice(0, index).filter((other) => other.status === column).length;
    return { left: `${column * 33.6}%`, top: `${12 + row * 30}%`, width: "32.4%", height: "26%" };
  }
  return { left: `${task.start * 100}%`, top: `${index * 19}%`, width: `${task.length * 100}%`, height: "16%" };
}

export function TasksMorph() {
  const { ref, frame } = useSteps([2400, 2400, 2600], 1);
  const mode = MODES[frame];
  return (
    <div ref={ref} aria-hidden className="select-none">
      <div className="flex border-b border-[var(--line-2)]">
        {MODES.map((item) => (
          <span key={item} className={cn("relative px-3 py-2 text-[13px] font-semibold", item === mode ? "text-[var(--ink)]" : "text-[var(--faint)]")}>
            {item}
            {item === mode ? <motion.span layoutId="d4-tasks-tab" className="absolute inset-x-0 bottom-[-1px] h-[3px] bg-[var(--ink)]" /> : null}
          </span>
        ))}
      </div>
      <div className="relative mt-4 h-[230px] sm:h-[250px]">
        {mode === "Board"
          ? STATUSES.map((status, index) => (
              <span key={status} className="d4-label absolute top-0 text-[10px] text-[var(--faint)]" style={{ left: `${index * 33.6}%` }}>
                {status}
              </span>
            ))
          : null}
        {mode === "Gantt"
          ? [0, 1, 2, 3].map((week) => (
              <span key={week} className="absolute inset-y-0 border-l border-dashed border-[var(--line)]" style={{ left: `${week * 25}%` }} />
            ))
          : null}
        {TASKS.map((task, index) => (
          <motion.span
            key={task.title}
            className="absolute flex items-center overflow-hidden px-2.5"
            style={{ background: C[task.color].bg, color: C[task.color].ink }}
            initial={false}
            animate={place(mode, index)}
            transition={{ duration: 0.75, ease, delay: index * 0.04 }}
          >
            <span className="truncate text-[12px] font-bold">{task.title}</span>
          </motion.span>
        ))}
      </div>
    </div>
  );
}

/* ---- Calendar views: day, week, month and agenda ---- */

const VIEWS = ["Day", "Week", "Month", "Agenda"] as const;

function ViewBody({ view }: { view: (typeof VIEWS)[number] }) {
  if (view === "Day")
    return (
      <div className="relative h-full border-l border-[var(--line)]">
        <span className="d4-event absolute inset-x-1 top-[8%] h-[16%] px-2 py-1 text-[11px] font-semibold">Weekly planning</span>
        <span className="absolute inset-x-1 top-[28%] h-[30%] px-2 py-1 text-[11px] font-bold" style={{ background: C.violet.bg, color: C.violet.ink }}>
          Write the launch brief
        </span>
        <span className="absolute inset-x-1 top-[66%] h-[12%] px-2 py-1 text-[11px] font-bold" style={{ background: C.amber.bg, color: C.amber.ink }}>
          Spanish lesson 12
        </span>
      </div>
    );
  if (view === "Week")
    return (
      <div className="grid h-full grid-cols-7">
        {Array.from({ length: 7 }, (_, day) => (
          <div key={day} className={cn("relative border-l border-[var(--line)]", day > 4 && "d4-offhours")}>
            {day < 5 ? (
              <>
                <span className="absolute inset-x-0.5" style={{ top: `${10 + ((day * 23) % 50)}%`, height: "22%", background: [C.violet.bg, C.amber.bg, C.blue.bg, C.pink.bg, C.cyan.bg][day] }} />
                <span className="d4-event absolute inset-x-0.5" style={{ top: `${60 + ((day * 7) % 20)}%`, height: "14%" }} />
              </>
            ) : null}
          </div>
        ))}
      </div>
    );
  if (view === "Month")
    return (
      <div className="grid h-full grid-cols-7 grid-rows-5 border-t border-l border-[var(--line)]">
        {Array.from({ length: 35 }, (_, cell) => (
          <span key={cell} className="relative border-r border-b border-[var(--line)] p-1">
            <span className="d4-mono text-[9px] text-[var(--faint)]">{((cell + 27) % 31) + 1}</span>
            {cell % 3 === 0 ? <span className="absolute inset-x-1 bottom-1 h-1.5" style={{ background: [C.violet.bg, C.green.bg, C.amber.bg, C.blue.bg][cell % 4] }} /> : null}
          </span>
        ))}
      </div>
    );
  return (
    <ul className="h-full">
      {[
        ["Mon 12", "09:00", "Weekly planning", null],
        ["Mon 12", "10:00", "Write the launch brief", C.violet.bg],
        ["Tue 13", "09:00", "Spanish lesson 12", C.amber.bg],
        ["Tue 13", "10:00", "Client review: Northwind", null],
        ["Wed 14", "13:05", "Build the launch budget", C.blue.bg],
      ].map(([day, time, title, color]) => (
        <li key={title} className="flex h-[20%] items-center gap-3 border-b border-[var(--line)] text-[12px]">
          <span className="d4-mono w-12 shrink-0 text-[var(--faint)]">{day}</span>
          <span className="d4-mono w-10 shrink-0 text-[var(--soft)]">{time}</span>
          <span className={cn("size-2.5 shrink-0", !color && "d4-event")} style={color ? { background: color } : undefined} />
          <span className="truncate font-medium">{title}</span>
        </li>
      ))}
    </ul>
  );
}

export function CalendarViews() {
  const { ref, frame } = useSteps([2200, 2200, 2200, 2200], 1);
  const view = VIEWS[frame];
  return (
    <div ref={ref} aria-hidden className="select-none">
      <div className="flex border border-[var(--line-2)]">
        {VIEWS.map((item) => (
          <span key={item} className={cn("relative flex-1 py-2 text-center text-[12.5px] font-semibold", item === view ? "text-[#0a0a0a]" : "text-[var(--soft)]")}>
            {item === view ? <motion.span layoutId="d4-cal-view" className="absolute inset-0 bg-[var(--ink)]" transition={{ duration: 0.35, ease }} /> : null}
            <span className="relative">{item}</span>
          </span>
        ))}
      </div>
      <div className="relative mt-3 h-[200px] overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.div
            key={view}
            className="absolute inset-0 bg-[var(--bg)]"
            initial={{ clipPath: "inset(0 0 0 100%)" }}
            animate={{ clipPath: "inset(0 0 0 0%)" }}
            exit={{ clipPath: "inset(0 100% 0 0)" }}
            transition={{ duration: 0.55, ease }}
          >
            <ViewBody view={view} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---- Search: Ctrl/Cmd+K, then results by kind ---- */

const RESULTS = [
  { kind: "Sheet", title: "Launch budget" },
  { kind: "Task", title: "Write the launch brief" },
  { kind: "Task", title: "Build the launch budget" },
  { kind: "Project", title: "Website launch" },
  { kind: "Doc", title: "Launch brief" },
];

export function SearchMini() {
  const { ref, frame } = useSteps([900, 500, 500, 600, 2600]);
  const query = ["", "la", "laun", "launch", "launch"][frame];
  const count = frame >= 3 ? RESULTS.length : frame === 2 ? 3 : frame === 1 ? 1 : 0;
  return (
    <div ref={ref} aria-hidden className="select-none">
      <div className="flex items-center gap-2">
        <kbd className={cn("transition-colors", frame === 0 && "!bg-[var(--ink)] !text-[#0a0a0a]")}>Ctrl</kbd>
        <span className="text-[var(--faint)]">+</span>
        <kbd className={cn("transition-colors", frame === 0 && "!bg-[var(--ink)] !text-[#0a0a0a]")}>K</kbd>
        <span className="ml-1 text-[12px] text-[var(--faint)]">or ⌘K</span>
      </div>
      <div className="mt-3 border border-[var(--line-2)] bg-[var(--panel)]">
        <p className="flex h-10 items-center border-b border-[var(--line-2)] px-3 text-[14px] font-medium">
          {query || <span className="text-[var(--faint)]">Search or run a command</span>}
          {query ? <span className="d4-caret" /> : null}
        </p>
        <ul className="h-[150px] overflow-hidden">
          {RESULTS.map((result, index) => (
            <motion.li
              key={result.title}
              className="flex h-[30px] items-center gap-3 border-b border-[var(--line)] px-3 text-[12.5px]"
              initial={false}
              animate={{ x: index < count ? 0 : "105%" }}
              transition={{ duration: 0.35, ease, delay: index * 0.04 }}
            >
              <span className="d4-label w-14 shrink-0 text-[9.5px] text-[var(--faint)]">{result.kind}</span>
              <span className="truncate font-medium">{result.title}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---- Dashboard: cards that move and resize ---- */

const CARDS: { id: string; title: string; value: string; color: ColorName }[] = [
  { id: "focus", title: "Focus time", value: "6h 40m", color: "green" },
  { id: "pomodoro", title: "Pomodoro", value: "25:00", color: "pink" },
  { id: "journal", title: "Daily journal", value: "Mon 12", color: "amber" },
  { id: "habits", title: "Habits", value: "3 of 4", color: "cyan" },
];
const LAYOUTS = [
  ["focus", "pomodoro", "journal", "habits"],
  ["pomodoro", "focus", "journal", "habits"],
  ["pomodoro", "focus", "habits", "journal"],
];

export function DashboardMini() {
  const { ref, frame } = useSteps([1800, 1800, 2200], 2);
  const order = LAYOUTS[frame];
  const wide = frame >= 1 ? "focus" : "journal";
  return (
    <div ref={ref} aria-hidden className="grid h-[214px] select-none grid-cols-3 grid-rows-2 gap-1.5">
      {order.map((id) => {
        const card = CARDS.find((item) => item.id === id)!;
        return (
          <motion.div
            key={id}
            layout
            transition={{ duration: 0.6, ease }}
            className={cn("relative flex flex-col justify-between border border-[var(--line-2)] bg-[var(--panel)] p-2.5", id === wide && "col-span-2")}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="size-2" style={{ background: C[card.color].bg }} />
              {card.title}
            </span>
            <span className="d4-num text-[26px] sm:text-[30px]">{card.value}</span>
            <span className="absolute right-1 bottom-1 size-2 border-r-2 border-b-2 border-[var(--faint)]" />
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---- Habits and goals ---- */

const HABITS = [
  { name: "Read 20 pages", done: [1, 1, 1, 1, 0, 1, 1], streak: 12 },
  { name: "Walk", done: [1, 0, 1, 1, 1, 1, 1], streak: 5 },
  { name: "Spanish", done: [1, 1, 1, 1, 1, 1, 0], streak: 26 },
];

export function HabitsMini() {
  const { ref, frame } = useSteps([1400, 1400, 2600]);
  return (
    <div ref={ref} aria-hidden className="select-none">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(7,18px)_36px] items-center gap-x-1 text-[10px] text-[var(--faint)]">
        <span />
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span key={index} className="text-center">
            {day}
          </span>
        ))}
        <span className="text-right">streak</span>
      </div>
      {HABITS.map((habit, row) => {
        const today = row <= frame;
        return (
          <div key={habit.name} className="mt-1.5 grid grid-cols-[minmax(0,1fr)_repeat(7,18px)_36px] items-center gap-x-1">
            <span className="truncate text-[13px] font-medium">{habit.name}</span>
            {habit.done.map((value, day) => {
              const on = day === 6 ? today : value === 1;
              return (
                <span key={day} className="relative h-[18px] border border-[var(--line-2)]">
                  <motion.span
                    className="absolute inset-0"
                    style={{ background: C.orange.bg, originY: 1 }}
                    initial={false}
                    animate={{ scaleY: on ? 1 : 0 }}
                    transition={{ duration: 0.3, ease }}
                  />
                </span>
              );
            })}
            <span className="d4-mono text-right text-[12px] font-semibold">{habit.streak + (today && habit.done[6] === 0 ? 1 : 0)}</span>
          </div>
        );
      })}
      <div className="mt-4 border-t border-[var(--line)] pt-3">
        {[
          { name: "Ship the new website", value: 0.62 },
          { name: "Reach B1 Spanish", value: 0.4 },
        ].map((goal) => (
          <div key={goal.name} className="mt-2 first:mt-0">
            <p className="flex justify-between text-[12px]">
              <span className="font-medium">{goal.name}</span>
              <span className="d4-mono text-[var(--soft)]">{Math.round(goal.value * 100)}%</span>
            </p>
            <div className="mt-1 h-1.5 bg-[rgb(243_242_237/10%)]">
              <motion.div
                className="h-full bg-[var(--ink)]"
                style={{ originX: 0 }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: goal.value }}
                viewport={{ once: true }}
                transition={{ duration: 1, ease }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

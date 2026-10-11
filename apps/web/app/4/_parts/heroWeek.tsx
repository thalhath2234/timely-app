"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { C, clock, WEEK, type ColorName } from "./data";
import { useReduced, useSteps } from "./kinetic";

const START = 8;
const END = 18;
const HOURS = END - START;

type Block = { day: number; from: number; to: number };

const EVENTS: (Block & { title: string })[] = [
  { day: 0, from: 9, to: 9.75, title: "Weekly planning" },
  { day: 1, from: 10, to: 11, title: "Client review: Northwind" },
  { day: 2, from: 12, to: 13, title: "Lunch with Sam" },
  { day: 3, from: 14, to: 15, title: "Dentist" },
  { day: 4, from: 9, to: 9.5, title: "Stand-up" },
  { day: 4, from: 12.5, to: 13.25, title: "Lunch" },
];

const TASKS: (Block & { title: string; length: string; project: string; color: ColorName; due: string })[] = [
  { title: "Write the launch brief", length: "2h", project: "Website refresh", color: "violet", due: "Fri 16", day: 0, from: 10, to: 12 },
  { title: "Spanish lesson 12", length: "45m", project: "Learn Spanish", color: "amber", due: "Sat 17", day: 1, from: 9, to: 9.75 },
  { title: "Book the moving van", length: "20m", project: "Move to the new flat", color: "green", due: "Wed 14", day: 1, from: 11 + 5 / 60, to: 11 + 25 / 60 },
  { title: "Build the launch budget", length: "1h", project: "Portfolio launch", color: "blue", due: "Thu 15", day: 2, from: 13 + 5 / 60, to: 14 + 5 / 60 },
  { title: "Send October invoices", length: "30m", project: "Studio", color: "pink", due: "Thu 15", day: 3, from: 15 + 5 / 60, to: 15 + 35 / 60 },
  { title: "Draft the Northwind proposal", length: "1h 30m", project: "Northwind", color: "cyan", due: "Fri 16", day: 4, from: 9 + 35 / 60, to: 11 + 5 / 60 },
];

type Phase = "type" | "chips" | "move" | "rest";
type Frame = { task: number; phase: Phase | "hold" | "clear"; ms: number };

const FRAMES: Frame[] = [
  ...TASKS.flatMap((_, task) => [
    { task, phase: "type" as const, ms: 950 },
    { task, phase: "chips" as const, ms: 750 },
    { task, phase: "move" as const, ms: 950 },
    { task, phase: "rest" as const, ms: 200 },
  ]),
  { task: TASKS.length, phase: "hold", ms: 3400 },
  { task: TASKS.length, phase: "clear", ms: 700 },
];
const MS = FRAMES.map((frame) => frame.ms);
const HOLD = FRAMES.length - 2;

const top = (hours: number) => `${((hours - START) / HOURS) * 100}%`;
const height = (block: Block) => `${((block.to - block.from) / HOURS) * 100}%`;

const ease = [0.7, 0, 0.2, 1] as const;

/**
 * The hero graphic: a thought is typed into Capture, Clarify adds its length,
 * project and deadline, then the block slides across to its day and down to
 * a free slot, around the hatched events and inside working hours.
 */
export default function HeroWeek() {
  const { ref, frame } = useSteps(MS, HOLD);
  const reduced = useReduced();
  const current = FRAMES[frame];
  const active = current.task < TASKS.length ? TASKS[current.task] : null;
  const placed = current.phase === "clear" ? 0 : current.phase === "hold" ? TASKS.length : current.task;
  const moving = active && (current.phase === "move" || current.phase === "rest") ? current.task : -1;
  const waiting = TASKS.length - placed - (moving >= 0 ? 1 : 0);

  return (
    <div ref={ref} className="relative select-none" aria-hidden>
      {/* Capture bar */}
      <div className="relative z-20 flex h-14 items-center gap-3 border border-[var(--line-2)] bg-[var(--bg)] px-3 sm:px-4">
        <span className="flex size-7 shrink-0 items-center justify-center bg-[var(--ink)] text-lg leading-none font-bold text-[#0a0a0a]">+</span>
        <div className="relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {active && current.phase !== "move" && current.phase !== "rest" ? (
              <motion.span
                key={`t-${current.task}`}
                className="shrink-0 truncate text-[15px] font-semibold tracking-[-0.02em] sm:text-base"
                initial={{ clipPath: "inset(0 100% 0 0)" }}
                animate={{ clipPath: "inset(0 0% 0 0)" }}
                exit={{ y: -16, opacity: 0, transition: { duration: 0.18 } }}
                transition={{ duration: 0.7, ease: "linear" }}
              >
                {active.title}
              </motion.span>
            ) : current.phase === "hold" || current.phase === "clear" ? (
              <motion.span
                key="summary"
                initial={{ y: 16 }}
                animate={{ y: 0 }}
                exit={{ y: -16, opacity: 0, transition: { duration: 0.18 } }}
                className="truncate text-[15px] font-semibold tracking-[-0.02em] sm:text-base"
              >
                {TASKS.length} placed · around {EVENTS.length} events · inside 09:00–17:00
              </motion.span>
            ) : (
              <motion.span key="empty" className="text-[15px] text-[var(--faint)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                Capture a thought
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {active && current.phase === "chips"
              ? [active.length, active.project, active.due].map((chip, index) => (
                  <motion.span
                    key={`${current.task}-${chip}`}
                    className={cn("d4-chip shrink-0", index === 2 && "hidden sm:inline-flex", index === 1 && "hidden md:inline-flex")}
                    initial={{ y: 22 }}
                    animate={{ y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, delay: index * 0.12, ease }}
                  >
                    {index === 1 ? <span className="size-2" style={{ background: C[active.color].bg }} /> : null}
                    {index === 2 ? "Due " : ""}
                    {chip}
                  </motion.span>
                ))
              : null}
          </AnimatePresence>
        </div>
        <span className="d4-mono hidden shrink-0 text-[11px] text-[var(--soft)] sm:block">
          Waiting for a slot <span className="ml-1 inline-block min-w-[1.2em] bg-[var(--ink)] px-1 text-center font-semibold text-[#0a0a0a]">{waiting}</span>
        </span>
      </div>

      {/* Week grid */}
      <div className="relative border-x border-b border-[var(--line-2)] bg-[var(--bg)]">
        <div className="grid grid-cols-[36px_repeat(5,minmax(0,1fr))] border-b border-[var(--line-2)] md:grid-cols-[44px_repeat(7,minmax(0,1fr))]">
          <span className="d4-mono flex items-end px-1.5 pb-2 text-[10px] text-[var(--faint)]">W{WEEK.number}</span>
          {WEEK.days.map((day, index) => (
            <span
              key={day.short}
              className={cn(
                "flex flex-col justify-between gap-0.5 border-l border-[var(--line)] px-1.5 pt-1.5 pb-1.5 lg:flex-row lg:items-baseline lg:gap-1 lg:px-2",
                index > 4 && "hidden md:flex",
              )}
            >
              <span className="d4-label text-[10px] text-[var(--soft)] sm:text-[11px]">{day.short}</span>
              <span className={cn("d4-num text-[22px] lg:text-[30px]", index > 4 && "text-[var(--faint)]")}>{day.date}</span>
            </span>
          ))}
        </div>

        <div className="grid grid-cols-[36px_minmax(0,1fr)] md:grid-cols-[44px_minmax(0,1fr)]">
          <div className="relative h-[300px] sm:h-[340px] lg:h-[360px]">
            {Array.from({ length: HOURS }, (_, index) => (
              <span key={index} className="d4-mono absolute right-1.5 -translate-y-1/2 text-[10px] text-[var(--faint)]" style={{ top: top(START + index) }}>
                {index === 0 ? "" : String(START + index).padStart(2, "0")}
              </span>
            ))}
          </div>

          <div className="relative h-[300px] [--cols:5] sm:h-[340px] md:[--cols:7] lg:h-[360px]">
            {/* hour lines */}
            {Array.from({ length: HOURS - 1 }, (_, index) => (
              <span key={index} className="absolute inset-x-0 border-t border-[var(--line)]" style={{ top: top(START + index + 1) }} />
            ))}
            {/* outside working hours */}
            <span className="d4-offhours absolute inset-x-0 top-0" style={{ height: top(9) }} />
            <span className="d4-offhours absolute inset-x-0 bottom-0" style={{ top: top(17) }} />
            {/* day columns, the weekend off */}
            {WEEK.days.map((day, index) => (
              <span
                key={day.short}
                className={cn("absolute inset-y-0 border-l border-[var(--line)]", index > 4 && "d4-offhours hidden md:block")}
                style={{ left: `calc(${index} * 100% / var(--cols))`, width: "calc(100% / var(--cols))" }}
              >
                {index === 5 ? (
                  <span className="d4-label absolute top-[48%] left-2 text-[10px] text-[var(--faint)]">Off</span>
                ) : null}
              </span>
            ))}

            {EVENTS.map((event) => (
              <span
                key={`${event.day}-${event.title}`}
                className="d4-event absolute overflow-hidden px-1.5 py-1"
                style={{
                  left: `calc(${event.day} * 100% / var(--cols) + 2px)`,
                  width: "calc(100% / var(--cols) - 4px)",
                  top: top(event.from),
                  height: height(event),
                }}
              >
                <span className="block truncate text-[10px] leading-tight font-semibold sm:text-[11px]">{event.title}</span>
              </span>
            ))}

            {TASKS.map((task, index) => {
              const shown = index < placed || index === moving;
              return (
                <span
                  key={task.title}
                  className="pointer-events-none absolute inset-y-0"
                  style={{ left: `calc(${task.day} * 100% / var(--cols))`, width: "calc(100% / var(--cols))" }}
                >
                  <AnimatePresence>
                    {shown ? (
                      <motion.span
                        key={task.title}
                        className="absolute inset-x-[2px] z-10 block overflow-hidden px-1.5 py-1"
                        style={{ background: C[task.color].bg, color: C[task.color].ink, height: `max(15px, ${height(task)})` }}
                        initial={reduced ? false : { x: `${-task.day * 100}%`, top: "-24%", scaleY: 0.6 }}
                        animate={
                          reduced
                            ? { x: "0%", top: top(task.from), scaleY: 1 }
                            : { x: [`${-task.day * 100}%`, "0%", "0%"], top: ["-24%", "-24%", top(task.from)], scaleY: [0.6, 0.6, 1] }
                        }
                        exit={{ x: "40%", opacity: 0, transition: { duration: 0.4, delay: index * 0.04 } }}
                        transition={{ duration: 0.85, times: [0, 0.45, 1], ease: [0.65, 0, 0.25, 1] }}
                      >
                        <span className="block truncate text-[10px] leading-tight font-bold tracking-[-0.01em] sm:text-[11px]">{task.title}</span>
                        <span className="d4-mono block truncate text-[9.5px] leading-tight opacity-80">
                          {clock(task.from)}–{clock(task.to)}
                        </span>
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-[var(--soft)]">
        <li className="flex items-center gap-2">
          <span className="size-3 bg-[var(--violet)]" />
          Work Timely placed
        </li>
        <li className="flex items-center gap-2">
          <span className="d4-event size-3" />
          Events it works around
        </li>
        <li className="flex items-center gap-2">
          <span className="d4-offhours size-3 border border-[var(--line)]" />
          Outside working hours
        </li>
      </ul>
    </div>
  );
}

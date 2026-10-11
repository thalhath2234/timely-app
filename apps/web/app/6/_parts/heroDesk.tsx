"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { NOTE, type NoteColor } from "./paper";
import { drop, settle, useLoop } from "./motionKit";

/*
 * The hero: notes land on the desk in a pile, get sorted into project lanes,
 * then slide into a real week as calendar blocks around fixed meetings.
 * Everything is placed in percentages of the desk so it scales from phone to
 * desktop. Frames: 0 pile, 1 lanes, 2 week, 3 focus, 4 clear (then drop again).
 */

type Phase = "pile" | "lanes" | "week" | "focus" | "clear";
const PHASES: Phase[] = ["pile", "lanes", "week", "focus", "clear"];
const DURATIONS = [2600, 2900, 3600, 3200, 750];
const REST = 3;

// The week grid: Mon 12 to Fri 16 October, 9:00 to 17:00.
const GRID = { left: 9.5, right: 98.5, top: 13, bottom: 97.5, from: 9, to: 17 };
const DAY_W = (GRID.right - GRID.left) / 5;
const HOUR_H = (GRID.bottom - GRID.top) / (GRID.to - GRID.from);
const DAYS = ["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"];

const round = (value: number) => Math.round(value * 100) / 100;

function slot(day: number, start: number, hours: number) {
  return {
    left: round(GRID.left + day * DAY_W + 0.6),
    top: round(GRID.top + (start - GRID.from) * HOUR_H + 0.35),
    width: round(DAY_W - 1.2),
    height: round(hours * HOUR_H - 0.7),
  };
}

function clock(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

type Task = {
  title: string;
  length: string;
  color: NoteColor;
  lane: number;
  pile: { left: number; top: number; rotate: number };
  day: number;
  start: number;
  hours: number;
};

const LANES: { name: string; color: NoteColor }[] = [
  { name: "Website refresh", color: "violet" },
  { name: "Learn Spanish", color: "yellow" },
  { name: "Move to the new flat", color: "green" },
];

const TASKS: Task[] = [
  { title: "Write the launch brief", length: "1h 30m", color: "violet", lane: 0, pile: { left: 6, top: 9, rotate: -7 }, day: 0, start: 10, hours: 1.5 },
  { title: "Spanish lesson 12", length: "45m", color: "yellow", lane: 1, pile: { left: 37, top: 4, rotate: 5 }, day: 2, start: 9, hours: 0.75 },
  { title: "Book the moving van", length: "30m", color: "green", lane: 2, pile: { left: 66, top: 11, rotate: -3 }, day: 0, start: 16, hours: 0.5 },
  { title: "Design the homepage", length: "2h", color: "violet", lane: 0, pile: { left: 15, top: 39, rotate: 4 }, day: 1, start: 13, hours: 2 },
  { title: "Review 40 flashcards", length: "30m", color: "yellow", lane: 1, pile: { left: 45, top: 33, rotate: -5 }, day: 4, start: 16, hours: 0.5 },
  { title: "Pack the bookshelf", length: "1h 30m", color: "green", lane: 2, pile: { left: 67, top: 45, rotate: 8 }, day: 4, start: 13, hours: 1.5 },
  { title: "Pick three case studies", length: "45m", color: "violet", lane: 0, pile: { left: 32, top: 63, rotate: -2 }, day: 3, start: 9, hours: 0.75 },
];

const MEETINGS = [
  { title: "Weekly planning", day: 0, start: 9, hours: 0.75 },
  { title: "Client review", day: 1, start: 10, hours: 1 },
  { title: "Lunch with Sam", day: 2, start: 12, hours: 1 },
  { title: "Dentist", day: 3, start: 14, hours: 1 },
  { title: "Standup", day: 4, start: 10, hours: 0.5 },
];

const NOTE_W = 28;
const NOTE_H = 29;
const LANE_TOP = [4, 36, 68];
const LANE_H = 28;

function laneSlot(task: Task) {
  const index = TASKS.filter((other) => other.lane === task.lane).indexOf(task);
  return { left: 24 + index * 25, top: LANE_TOP[task.lane] + 3.2, width: 23, height: LANE_H - 6.4 };
}

const FOCUS_TASK = 3; // "Design the homepage", Tue 13:00
const NOW = 13 + 40 / 60;

const CAPTIONS = [
  { phase: ["pile", "clear"], label: "Captured", detail: "7 notes in the Inbox" },
  { phase: ["lanes"], label: "Clarified", detail: "a project and a length each" },
  { phase: ["week"], label: "Auto-scheduled", detail: "around 5 meetings, 9:00–17:00" },
  { phase: ["focus"], label: "In focus", detail: "Tue 13:40, Design the homepage" },
];

function target(task: Task, index: number, phase: Phase) {
  if (phase === "pile") {
    return { ...task.pile, width: NOTE_W, height: NOTE_H, y: 0 };
  }
  if (phase === "clear") {
    return { left: task.pile.left, top: -48, width: NOTE_W, height: NOTE_H, rotate: task.pile.rotate * 2, y: 0 };
  }
  if (phase === "lanes") {
    return { ...laneSlot(task), rotate: index % 2 ? 1.2 : -1.4, y: 0 };
  }
  return { ...slot(task.day, task.start, task.hours), rotate: 0, y: 0 };
}

function transitionFor(index: number, phase: Phase) {
  if (phase === "pile") return { ...drop, delay: 0.1 + index * 0.24 };
  if (phase === "clear") return { duration: 0.45, ease: [0.5, 0, 0.75, 0] as const, delay: index * 0.035 };
  if (phase === "lanes") return { ...settle, delay: index * 0.07 };
  return { ...settle, delay: 0.25 + index * 0.08 };
}

export default function HeroDesk() {
  const { ref, frame } = useLoop(PHASES.length, DURATIONS, REST, 0.25);
  const phase = PHASES[frame];
  const inWeek = phase === "week" || phase === "focus";
  const inLanes = phase === "lanes";
  const caption = CAPTIONS.findIndex((item) => item.phase.includes(phase));

  return (
    <div ref={ref}>
      <div
        role="img"
        aria-label="Seven sticky notes land on a desk, get sorted into three projects, then become blocks on a week calendar from Monday 12 to Friday 16 October, placed around five meetings."
        className="d6-desk d6-mat"
      >
        {/* Week scaffolding: day heads, hour rules, meetings. */}
        <div aria-hidden className={cn("d6-fade absolute inset-0", inWeek ? "opacity-100" : "opacity-0")}>
          {DAYS.map((day, index) => (
            <span
              key={day}
              className="d6-desk-label d6-display absolute flex items-center font-bold text-[var(--soft)]"
              style={{ left: `${GRID.left + index * DAY_W + 0.8}%`, top: "3.5%", height: "7%" }}
            >
              {day}
            </span>
          ))}
          {Array.from({ length: GRID.to - GRID.from + 1 }, (_, index) => (
            <div key={index} className="absolute right-[1.5%] left-[2.5%]" style={{ top: `${GRID.top + index * HOUR_H}%` }}>
              <span className="d6-desk-label d6-mono absolute -top-[0.7em] left-0 text-[var(--faint)]">
                {GRID.from + index}
              </span>
              <span className="absolute left-[7.4%] right-0 top-0 h-px bg-[rgb(255_244_225/0.08)]" />
            </div>
          ))}
          {DAYS.slice(1).map((day, index) => (
            <span
              key={day}
              className="absolute w-px bg-[rgb(255_244_225/0.07)]"
              style={{ left: `${GRID.left + (index + 1) * DAY_W}%`, top: `${GRID.top}%`, bottom: `${100 - GRID.bottom}%` }}
            />
          ))}
          {MEETINGS.map((meeting, index) => {
            const box = slot(meeting.day, meeting.start, meeting.hours);
            return (
              <motion.div
                key={meeting.title}
                initial={false}
                animate={{ y: inWeek ? 0 : -6 }}
                transition={{ ...settle, delay: index * 0.05 }}
                className="d6-hatch d6-desk-block absolute overflow-hidden rounded-[4px] px-[0.45em] py-[0.3em] text-[var(--soft)]"
                style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
              >
                <span className="block truncate font-semibold">{meeting.title}</span>
              </motion.div>
            );
          })}
        </div>

        {/* Project lanes. */}
        <div aria-hidden className={cn("d6-fade absolute inset-0", inLanes ? "opacity-100" : "opacity-0")}>
          {LANES.map((lane, index) => (
            <div
              key={lane.name}
              className="absolute right-[2%] left-[2%] rounded-xl border border-dashed"
              style={{
                top: `${LANE_TOP[index]}%`,
                height: `${LANE_H}%`,
                borderColor: `color-mix(in oklch, ${NOTE[lane.color]} 45%, transparent)`,
                background: `color-mix(in oklch, ${NOTE[lane.color]} 8%, transparent)`,
              }}
            >
              <span className="d6-display absolute top-[12%] left-[3%] w-[17%] text-[clamp(10px,1.75cqw,15px)] leading-tight font-bold" style={{ color: NOTE[lane.color] }}>
                {lane.name}
              </span>
              <span className="d6-desk-label absolute bottom-[12%] left-[3%] text-[var(--faint)]">
                {TASKS.filter((task) => task.lane === index).length} notes
              </span>
            </div>
          ))}
        </div>

        {/* The notes themselves. */}
        {TASKS.map((task, index) => {
          const box = target(task, index, phase);
          const block = inWeek;
          const tiny = task.hours < 0.8;
          const focused = phase === "focus" && index === FOCUS_TASK;
          return (
            <motion.div
              key={task.title}
              aria-hidden
              initial={false}
              animate={{
                left: `${box.left}%`,
                top: `${box.top}%`,
                width: `${box.width}%`,
                height: `${box.height}%`,
                rotate: box.rotate,
              }}
              transition={transitionFor(index, phase)}
              className="d6-note absolute overflow-hidden"
              style={{
                ["--c" as string]: NOTE[task.color],
                zIndex: phase === "pile" ? index + 1 : 5,
                borderRadius: block ? 5 : undefined,
                boxShadow: focused ? "0 0 0 2px var(--ink), 0 12px 24px -8px rgb(0 0 0 / 70%)" : undefined,
              }}
            >
              {/* Handwritten face (pile and lanes). */}
              <div className={cn("d6-fade absolute inset-0 flex flex-col p-[9%]", block ? "opacity-0" : "opacity-100")}>
                <span className="d6-hand d6-desk-hand font-bold">{task.title}</span>
                <span className="mt-auto flex items-end justify-between gap-1">
                  <AnimatePresence initial={false}>
                    {inLanes ? (
                      <motion.span
                        key="len"
                        initial={{ scale: 1.6, rotate: -12 }}
                        animate={{ scale: 1, rotate: -3 }}
                        exit={{ scale: 0.6 }}
                        transition={{ ...drop, delay: 0.35 + index * 0.08 }}
                        className="d6-desk-label rounded-full bg-[var(--paper-ink)] px-[0.6em] py-[0.15em] font-semibold text-[var(--n-cream)]"
                      >
                        {task.length}
                      </motion.span>
                    ) : (
                      <span key="cap" className="d6-desk-label d6-mono text-[var(--paper-soft)]">
                        Inbox
                      </span>
                    )}
                  </AnimatePresence>
                </span>
              </div>
              {/* Calendar-block face (week). */}
              <div className={cn("d6-fade d6-desk-block absolute inset-0 px-[0.5em] py-[0.3em]", block ? "opacity-100" : "opacity-0")}>
                <span className={cn("block font-bold", tiny ? "truncate" : "line-clamp-2")}>{task.title}</span>
                {!tiny ? (
                  <span className="d6-mono block text-[0.9em] text-[var(--paper-soft)]">
                    {clock(task.start)}–{clock(task.start + task.hours)}
                  </span>
                ) : null}
              </div>
            </motion.div>
          );
        })}

        {/* Now line and focus badge. */}
        <AnimatePresence>
          {phase === "focus" ? (
            <motion.div
              key="now"
              aria-hidden
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute z-10 h-[2px] origin-left bg-[#ff6b5c]"
              style={{ left: `${GRID.left}%`, right: `${100 - GRID.right}%`, top: `${GRID.top + (NOW - GRID.from) * HOUR_H}%` }}
            >
              <span className="absolute -top-[4px] -left-[5px] size-[10px] rounded-full bg-[#ff6b5c]" />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {phase === "focus" ? (
            <motion.div
              key="badge"
              aria-hidden
              initial={{ y: 10, scale: 0.9, rotate: -4 }}
              animate={{ y: 0, scale: 1, rotate: -2 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={drop}
              className="d6-desk-label absolute z-20 flex items-center gap-[0.5em] rounded-full bg-[var(--ink)] px-[0.8em] py-[0.35em] font-bold text-[var(--paper-ink)] shadow-lg"
              style={{ left: `${GRID.left + DAY_W * 1 + 1}%`, top: `${GRID.top + (15.2 - GRID.from) * HOUR_H}%` }}
            >
              <span className="size-[0.6em] rounded-full bg-[#e5484d]" />
              In focus · 0:40
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* What is happening, in words. */}
      <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" aria-label="What the desk shows">
        {CAPTIONS.map((item, index) => {
          const on = index === caption;
          return (
            <li key={item.label} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-1 flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-bold transition-colors duration-300",
                  on ? "bg-[var(--n-yellow)] text-[var(--paper-ink)]" : "bg-[var(--desk-3)] text-[var(--soft)]",
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 leading-snug">
                <span className={cn("d6-display block text-[0.95rem] font-bold transition-colors", on ? "text-[var(--ink)]" : "text-[var(--soft)]")}>
                  {item.label}
                </span>
                <span className="d6-faint block text-[0.8rem]">{item.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

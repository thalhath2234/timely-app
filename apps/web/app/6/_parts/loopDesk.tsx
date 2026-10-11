"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { CornerDownLeft, Square } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { NOTE } from "./paper";
import { drop, settle } from "./motionKit";

/*
 * How it works: one note travels through Capture, Clarify, Auto-schedule and
 * Focus. On wide screens the desk stays pinned while the steps scroll past; on
 * phones each step carries its own still of the desk.
 */

const STEPS = [
  {
    name: "Capture",
    keys: ["g", "i"],
    text: "Type the thought into the Inbox and press Enter. It needs no project, date or length yet. On your phone, use the + button.",
  },
  {
    name: "Clarify",
    keys: null,
    text: "Turn it into Work: a project, a length, a priority and a deadline. Smart suggestions fill these in from your words, and you keep or change each one.",
  },
  {
    name: "Auto-schedule",
    keys: null,
    text: "Timely places Work in the earliest free time that fits, inside your working hours, around your events, most urgent first. Read the preview, then choose Apply schedule.",
  },
  {
    name: "Focus",
    keys: null,
    text: "When the block comes up, choose Start Focus. The minutes go onto the task's actual time and into the Dashboard's Focus time card.",
  },
];

const THOUGHT = "Prep slides for the client review";

// Mini calendar: Tue to Thu, 9:00 to 13:00.
const CAL = { left: 13, right: 97, top: 15, bottom: 95, from: 9, to: 13 };
const COL = (CAL.right - CAL.left) / 3;
const HOUR = (CAL.bottom - CAL.top) / (CAL.to - CAL.from);
function cell(day: number, start: number, hours: number) {
  return {
    left: CAL.left + day * COL + 0.8,
    top: CAL.top + (start - CAL.from) * HOUR + 0.5,
    width: COL - 1.6,
    height: hours * HOUR - 1,
  };
}
const MEETINGS = [
  { title: "Client call", day: 0, start: 10, hours: 1 },
  { title: "Weekly planning", day: 1, start: 9, hours: 0.75 },
  { title: "Lunch", day: 1, start: 12, hours: 1 },
  { title: "Client review", day: 2, start: 11, hours: 1 },
];

const STICKERS = [
  { text: "Work", color: NOTE.blue, r: -4 },
  { text: "1h 30m", color: NOTE.cream, r: 3 },
  { text: "High", color: NOTE.orange, r: -2 },
  { text: "Northwind", color: NOTE.green, r: 2 },
  { text: "Due Thu", color: NOTE.pink, r: -3 },
];

const NOTE_AT = [
  { left: 29, top: 36, width: 42, height: 46, rotate: -3 },
  { left: 18, top: 8, width: 64, height: 78, rotate: 1.5 },
  cell(1, 10, 1.5),
  { left: 12, top: 10, width: 76, height: 80, rotate: -1 },
];

function useTicker(active: boolean) {
  const reduced = useReducedMotion();
  const [seconds, setSeconds] = useState(24 * 60 + 13);
  useEffect(() => {
    if (!active || reduced) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active, reduced]);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `0:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function Typed({ text, active }: { text: string; active: boolean }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active || count >= text.length) return;
    const timer = window.setTimeout(() => setCount(reduced ? text.length : count + 1), 45);
    return () => window.clearTimeout(timer);
  }, [active, count, reduced, text.length]);
  return (
    <>
      {text.slice(0, count)}
      <span className="d6-caret ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[var(--n-yellow)]" />
    </>
  );
}

function Stage({ step, live = false }: { step: number; live?: boolean }) {
  const at = NOTE_AT[step];
  const timer = useTicker(live && step === 3);
  return (
    <div
      role="img"
      aria-label={`${STEPS[step].name}: the note “${THOUGHT}” ${
        ["lands in the Inbox", "gets a project, length, priority and deadline", "is placed on Wednesday 10:00 to 11:30, around meetings", "is in focus, with a running timer"][step]
      }.`}
      className="d6-desk d6-mat !aspect-[5/4]"
    >
      {/* Inbox capture box */}
      <div aria-hidden className={cn("d6-fade absolute inset-x-[7%] top-[8%]", step === 0 ? "opacity-100" : "opacity-0")}>
        <p className="d6-desk-label d6-display font-bold text-[var(--soft)]">Inbox</p>
        <div className="mt-[1.5%] flex items-center gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--desk)] px-[3%] py-[2.2%] text-[clamp(11px,2.1cqw,16px)] text-[var(--ink)]">
          <span className="min-w-0 flex-1 truncate">{step === 0 ? <Typed text={THOUGHT} active={live} /> : THOUGHT}</span>
          <CornerDownLeft className="size-[1.1em] shrink-0 text-[var(--faint)]" />
        </div>
      </div>

      {/* Mini calendar */}
      <div aria-hidden className={cn("d6-fade absolute inset-0", step === 2 ? "opacity-100" : "opacity-0")}>
        {["Tue", "Wed", "Thu"].map((day, index) => (
          <span
            key={day}
            className="d6-desk-label d6-display absolute font-bold text-[var(--soft)]"
            style={{ left: `${CAL.left + index * COL + 1}%`, top: "5%" }}
          >
            {day}
          </span>
        ))}
        {Array.from({ length: CAL.to - CAL.from + 1 }, (_, index) => (
          <div key={index} className="absolute right-[3%] left-[3%]" style={{ top: `${CAL.top + index * HOUR}%` }}>
            <span className="d6-desk-label d6-mono absolute -top-[0.7em] left-0 text-[var(--faint)]">{CAL.from + index}:00</span>
            <span className="absolute top-0 right-0 left-[10.5%] h-px bg-[rgb(255_244_225/0.08)]" />
          </div>
        ))}
        {MEETINGS.map((meeting) => {
          const box = cell(meeting.day, meeting.start, meeting.hours);
          return (
            <div
              key={meeting.title}
              className="d6-hatch d6-desk-block absolute rounded-[4px] px-[0.6em] py-[0.4em] font-semibold text-[var(--soft)]"
              style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
            >
              {meeting.title}
            </div>
          );
        })}
        <span
          className="d6-desk-label absolute right-[3%] bottom-[-1%] translate-y-[-60%] rounded-md bg-[var(--n-yellow)] px-[0.8em] py-[0.3em] font-bold text-[var(--paper-ink)]"
        >
          Apply schedule
        </span>
      </div>

      {/* The note */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ left: `${at.left}%`, top: `${at.top}%`, width: `${at.width}%`, height: `${at.height}%`, rotate: "rotate" in at ? at.rotate : 0 }}
        transition={settle}
        className="d6-note absolute z-10 overflow-hidden"
        style={{ ["--c" as string]: NOTE.yellow, borderRadius: step === 2 ? 5 : undefined }}
      >
        {/* Handwritten face */}
        <div className={cn("d6-fade absolute inset-0 flex flex-col p-[6%]", step <= 1 ? "opacity-100" : "opacity-0")}>
          <span className={cn("d6-hand font-bold leading-[1.1]", step === 1 ? "text-[clamp(16px,4.1cqw,30px)]" : "text-[clamp(14px,3.3cqw,24px)]")}>
            {THOUGHT}
          </span>
          {step === 0 ? <span className="d6-mono d6-desk-label mt-auto text-[var(--paper-soft)]">captured 08:12</span> : null}
          {step === 1 ? (
            <span className="mt-auto flex flex-wrap gap-[0.45em] text-[clamp(10px,2cqw,15px)]">
              {STICKERS.map((sticker, index) => (
                <motion.span
                  key={sticker.text}
                  initial={live ? { scale: 1.6, rotate: sticker.r * 4, y: -20 } : false}
                  animate={{ scale: 1, rotate: sticker.r, y: 0 }}
                  transition={{ ...drop, delay: 0.15 + index * 0.12 }}
                  className="rounded-[4px] px-[0.6em] py-[0.25em] font-bold shadow-[0_2px_4px_rgb(0_0_0/0.25)]"
                  style={{ background: sticker.color }}
                >
                  {sticker.text}
                </motion.span>
              ))}
            </span>
          ) : null}
        </div>
        {/* Calendar block face */}
        <div className={cn("d6-fade d6-desk-block absolute inset-0 p-[0.6em]", step === 2 ? "opacity-100" : "opacity-0")}>
          <span className="block font-bold">{THOUGHT}</span>
          <span className="d6-mono mt-[0.2em] block text-[var(--paper-soft)]">10:00–11:30</span>
        </div>
        {/* Focus face */}
        <div className={cn("d6-fade absolute inset-0 flex flex-col p-[6%]", step === 3 ? "opacity-100" : "opacity-0")}>
          <span className="flex items-center gap-2 text-[clamp(10px,2cqw,15px)] font-bold">
            <span className="size-[0.7em] rounded-full bg-[#e5484d]" />
            In focus · Wed 10:00
          </span>
          <span className="d6-hand mt-[2%] text-[clamp(15px,3.6cqw,28px)] leading-[1.1] font-bold">{THOUGHT}</span>
          <span className="d6-display mt-auto text-[clamp(34px,11cqw,92px)] leading-none font-extrabold tabular-nums tracking-[-0.04em]">
            {timer}
          </span>
          <span className="mt-[3%] flex items-center justify-between gap-2 text-[clamp(10px,1.9cqw,14px)] font-semibold text-[var(--paper-soft)]">
            <span>Adds to actual time</span>
            <span className="flex items-center gap-1.5 rounded-md bg-[var(--paper-ink)] px-[0.8em] py-[0.35em] text-[var(--n-cream)]">
              <Square className="size-[0.85em] fill-current" />
              Stop
            </span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function StepText({ index, onActive, active }: { index: number; onActive: (index: number) => void; active: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);
  return (
    <li ref={ref} className="flex min-h-[58vh] flex-col justify-center py-8">
      <StepCopy index={index} active={active} />
    </li>
  );
}

function StepCopy({ index, active = true }: { index: number; active?: boolean }) {
  const step = STEPS[index];
  return (
    <div>
      <p className="flex items-center gap-3">
        <span
          className={cn(
            "d6-display flex size-11 items-center justify-center rounded-[6px] text-2xl font-extrabold transition-colors duration-300",
            active ? "bg-[var(--n-yellow)] text-[var(--paper-ink)]" : "bg-[var(--desk-3)] text-[var(--soft)]",
          )}
        >
          {index + 1}
        </span>
        {step.keys ? (
          <span className="d6-faint flex items-center gap-1 text-sm">
            Inbox: <kbd className="d6-kbd">g</kbd> then <kbd className="d6-kbd">i</kbd>
          </span>
        ) : null}
      </p>
      <h3
        className={cn(
          "d6-display mt-4 text-[2rem] leading-tight font-extrabold transition-colors duration-500 sm:text-[2.6rem]",
          active ? "text-[var(--ink)]" : "text-[var(--faint)]",
        )}
      >
        {step.name}
      </h3>
      <p className="d6-soft mt-3 max-w-md text-[1.05rem] leading-relaxed">{step.text}</p>
    </div>
  );
}

export default function LoopDesk() {
  const [active, setActive] = useState(0);
  return (
    <>
      {/* Wide screens: pinned desk, scrolling steps. */}
      <div className="mt-6 hidden gap-16 lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ol>
          {STEPS.map((step, index) => (
            <StepText key={step.name} index={index} active={index === active} onActive={setActive} />
          ))}
        </ol>
        <div>
          <div className="sticky top-[calc(50vh-240px)]">
            <div className="mb-4 flex gap-2" aria-hidden>
              {STEPS.map((step, index) => (
                <span
                  key={step.name}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors duration-500",
                    index <= active ? "bg-[var(--n-yellow)]" : "bg-[var(--desk-3)]",
                  )}
                />
              ))}
            </div>
            <Stage step={active} live />
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={active}
                initial={{ y: 6 }}
                animate={{ y: 0 }}
                exit={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="d6-faint mt-3 text-sm"
              >
                Step {active + 1} of 4 · {STEPS[active].name}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Phones and tablets: one still per step. */}
      <ol className="mt-10 space-y-14 lg:hidden">
        {STEPS.map((step, index) => (
          <li key={step.name}>
            <StepCopy index={index} />
            <div className="mt-6">
              <Stage step={index} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

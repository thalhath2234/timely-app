"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useInView, useScroll, useSpring } from "motion/react";
import { Check, CornerDownLeft, Play, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { useCalm, useFrames } from "./shell";

const ease = [0.22, 1, 0.36, 1] as const;

/* ---- Capture ---- */

const CAPTURE_MS = [900, 1800, 1300, 2600] as const;
const TYPED = "write launch brief";

function CaptureCard() {
  const { ref, frame } = useFrames(4, CAPTURE_MS, 3);
  const typed = frame === 0 ? "" : frame === 1 ? TYPED.slice(0, 11) : frame === 2 ? TYPED : "";
  const landed = frame === 3;
  return (
    <div ref={ref} className="loop-card" aria-hidden>
      <div className="flex h-11 items-center gap-2 rounded-xl border border-[var(--line-2)] px-3.5">
        <span className="min-w-0 flex-1 truncate text-[15px]">
          {typed || <span className="text-[var(--faint)]">Capture a thought…</span>}
          {frame === 1 || frame === 2 ? <span className="caret" /> : null}
        </span>
        <CornerDownLeft
          className={cn("size-4 transition-colors", frame === 2 ? "text-[var(--mint)]" : "text-[var(--faint)]")}
        />
      </div>
      <p className="label mt-4 mb-1">Inbox</p>
      <ul className="text-[14.5px]">
        <AnimatePresence initial={false}>
          {landed ? (
            <motion.li
              key="new"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.5, ease }}
              className="overflow-hidden"
            >
              <span className="flex items-center justify-between gap-2 border-b border-[var(--line)] py-2 font-semibold">
                write launch brief
                <span className="text-[12.5px] font-normal text-[var(--mint)]">just now</span>
              </span>
            </motion.li>
          ) : null}
        </AnimatePresence>
        {["Book the moving van", "Spanish lesson 12", "Ask Sam about the deck"].map((item) => (
          <li
            key={item}
            className="flex justify-between gap-2 border-b border-[var(--line)] py-2 text-[var(--soft)] last:border-0"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- Clarify ---- */

const CLARIFY_FIELDS = [
  ["Length", "1h 30m"],
  ["Project", "Website refresh"],
  ["Due", "Tue 13 Oct"],
  ["Priority", "High"],
] as const;
const CLARIFY_MS = [900, 650, 650, 650, 650, 2600] as const;

function ClarifyCard() {
  const { ref, frame } = useFrames(6, CLARIFY_MS, 5);
  const filled = frame;
  return (
    <div ref={ref} className="loop-card" aria-hidden>
      <p className="text-[16px] font-semibold">Write the launch brief</p>
      <div className="mt-3 inline-flex rounded-full border border-[var(--line-2)] p-1 text-[13px]">
        <span
          className={cn(
            "rounded-full px-3 py-0.5 transition-colors duration-500",
            frame >= 1 ? "bg-[var(--mint)] font-semibold text-[var(--mint-ink)]" : "text-[var(--soft)]",
          )}
        >
          Work
        </span>
        <span className="px-3 py-0.5 text-[var(--soft)]">Reminder</span>
      </div>
      <dl className="mt-3 grid">
        {CLARIFY_FIELDS.map(([label, value], i) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2 text-[14.5px] last:border-0"
          >
            <dt className="text-[var(--faint)]">{label}</dt>
            <dd className={cn("transition-opacity duration-500", i < filled ? "opacity-100" : "opacity-0")}>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3 text-[var(--mint)]" />
                {value}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---- Auto-schedule: a mini week ---- */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
/* Hours 08–18 mapped to 0–100%. */
const y = (h: number) => `${((h - 8) / 10) * 100}%`;
const hgt = (a: number, b: number) => `${((b - a) / 10) * 100}%`;
const MEETINGS = [
  { d: 0, a: 9, b: 9.75 },
  { d: 0, a: 12.5, b: 13.25 },
  { d: 1, a: 10, b: 11 },
  { d: 2, a: 12, b: 13 },
  { d: 2, a: 14, b: 15 },
  { d: 3, a: 9, b: 10 },
  { d: 4, a: 12.5, b: 13.5 },
];
const PLACED = [
  { d: 0, a: 10.75, b: 12.25, label: "Launch brief" },
  { d: 1, a: 14, b: 15, label: "Invoices" },
  { d: 3, a: 10.25, b: 12, label: "Homepage 1/2" },
  { d: 4, a: 9, b: 10.5, label: "Homepage 2/2" },
];
const SCHEDULE_MS = [1100, 500, 500, 500, 500, 1300, 2800] as const;

function ScheduleCard() {
  const { ref, frame } = useFrames(7, SCHEDULE_MS, 6);
  const placed = Math.max(0, Math.min(frame - 1, PLACED.length));
  const applied = frame === 6;
  return (
    <div ref={ref} className="loop-card" aria-hidden>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] px-3 py-1 text-[13px]">
          <Wand2 className="size-3.5 text-[var(--mint)]" />
          Auto-schedule
          <span className="num text-[var(--faint)]">{PLACED.length - placed}</span>
        </span>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-500",
            applied ? "bg-[rgb(168_224_195/14%)] text-[var(--mint)]" : "bg-[var(--mint)] text-[var(--mint-ink)]",
          )}
        >
          {applied ? "Applied" : "Apply schedule"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[12px] text-[var(--faint)]">
        {DAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="relative mt-1 grid h-[150px] grid-cols-5 gap-1">
        {DAYS.map((day, d) => (
          <div key={day} className="relative overflow-hidden rounded-md bg-[rgb(190_225_205/3%)]">
            <div
              className="absolute inset-x-0 border-y border-dashed border-[rgb(168_224_195/18%)] bg-[rgb(168_224_195/4%)]"
              style={{ top: y(9), height: hgt(9, 17) }}
            />
            {MEETINGS.filter((m) => m.d === d).map((m) => (
              <span
                key={m.a}
                className="absolute inset-x-[3px] rounded-[4px] bg-[var(--meeting)]"
                style={{ top: y(m.a), height: hgt(m.a, m.b) }}
              />
            ))}
            {PLACED.map((p, i) =>
              p.d === d ? (
                <motion.span
                  key={p.label}
                  initial={false}
                  animate={{
                    opacity: i < placed ? 1 : 0,
                    y: i < placed ? 0 : -14,
                  }}
                  transition={{ type: "spring", stiffness: 160, damping: 18 }}
                  className="absolute inset-x-[3px] overflow-hidden rounded-[4px] bg-[var(--mint)] px-1 pt-0.5 text-left text-[10px] leading-tight font-semibold text-[var(--mint-ink)]"
                  style={{ top: y(p.a), height: hgt(p.a, p.b) }}
                >
                  <span className="hidden sm:inline">{p.label}</span>
                </motion.span>
              ) : null,
            )}
          </div>
        ))}
      </div>
      <p className="mt-2.5 flex justify-between text-[12.5px] text-[var(--faint)]">
        <span>Working hours shaded</span>
        <span>{applied ? "Undo last apply" : "Preview"}</span>
      </p>
    </div>
  );
}

/* ---- Focus ---- */

const FOCUS_MS = [1300, 4200, 2400] as const;

function FocusCard() {
  const { ref, frame, calm } = useFrames(3, FOCUS_MS, 1);
  const running = frame >= 1;
  return (
    <div ref={ref} className="loop-card" aria-hidden>
      <p className="label">Today focus</p>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <span className="min-w-0">
          <span className="block truncate text-[15.5px] font-semibold">Write the launch brief</span>
          <span className="block text-[13px] text-[var(--soft)]">10:45 – 12:15 · Website refresh</span>
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-500",
            running ? "bg-[rgb(168_224_195/14%)] text-[var(--mint)]" : "bg-[var(--mint)] text-[var(--mint-ink)]",
          )}
        >
          {running ? <span className="size-1.5 rounded-full bg-[var(--mint)]" /> : <Play className="size-3" />}
          {running ? "In focus" : "Start Focus"}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="relative size-[88px] shrink-0">
          <FocusRing running={running && !calm} rest={calm} />
          <span className="num absolute inset-0 flex items-center justify-center text-[19px] font-light">
            {frame === 2 ? "21:40" : running ? "24:12" : "25:00"}
          </span>
        </div>
        <div className="text-[13.5px] leading-snug">
          <p className="text-[var(--faint)]">Focus time today</p>
          <p className="num text-[20px] font-light text-[var(--ink)]">{frame === 2 ? "1h 43m" : "1h 40m"}</p>
          <p className="mt-1 flex items-center gap-1 text-[var(--soft)]">
            <Check className="size-3.5 text-[var(--mint)]" />
            Counts toward the task
          </p>
        </div>
      </div>
    </div>
  );
}

function FocusRing({ running, rest }: { running: boolean; rest: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
      <circle cx="50" cy="50" r="45" fill="none" stroke="var(--line-2)" strokeWidth="3" />
      <motion.circle
        cx="50"
        cy="50"
        r="45"
        fill="none"
        stroke="var(--mint)"
        strokeWidth="3"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: rest ? 0.13 : running ? 0.13 : 0.001 }}
        transition={{ duration: running ? 4 : 0.6, ease: "linear" }}
      />
    </svg>
  );
}

/* ---- The loop, as one morning ---- */

const STEPS = [
  {
    when: "08:47 · on the bus",
    name: "Capture",
    body: "Type the thought into the Inbox the moment it shows up. It needs nothing but a title.",
    card: <CaptureCard />,
  },
  {
    when: "09:05 · first coffee",
    name: "Clarify",
    body: "Decide what it is: Work that takes time, with a length and a project, or a Reminder at a set time.",
    card: <ClarifyCard />,
  },
  {
    when: "09:06 · one click",
    name: "Auto-schedule",
    body: "Timely places Work as blocks in free time inside your working hours, by deadline and priority. Preview it, apply it, or undo the last apply.",
    card: <ScheduleCard />,
  },
  {
    when: "10:45 · the block begins",
    name: "Focus",
    body: "Today shows what is next. Start Focus and the time counts toward the task and your Focus time card.",
    card: <FocusCard />,
  },
];

function Step({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const reached = useInView(ref, { margin: "0px 0px -45% 0px" });
  const calm = useCalm();
  return (
    <li ref={ref} className="loop-step" style={{ "--on": reached || calm ? 1 : 0 } as React.CSSProperties}>
      <span className="loop-dot" aria-hidden />
      <div>
        <p className="when num">{step.when}</p>
        <h3>
          <span className="sr">Step {index + 1}: </span>
          {step.name}
        </h3>
        <p className="mt-2 max-w-[30rem] text-[16.5px] text-[var(--soft)]">{step.body}</p>
      </div>
      {step.card}
    </li>
  );
}

export default function Loop() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.6", "end 0.6"],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return (
    <div ref={ref} className="loop">
      <span className="loop-line" aria-hidden>
        <motion.span style={{ scaleY: fill }} />
      </span>
      <ol className="grid">
        {STEPS.map((step, index) => (
          <Step key={step.name} step={step} index={index} />
        ))}
      </ol>
    </div>
  );
}

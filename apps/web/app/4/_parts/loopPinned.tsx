"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { cn } from "@/app/utils/cn";
import { C, type ColorName } from "./data";
import { useReduced } from "./kinetic";

type Step = {
  key: string;
  name: string;
  color: ColorName;
  day: string;
  body: string;
  detail: string;
  Graphic: (props: { p: MotionValue<number> }) => ReactNode;
};

/* ---- 1 · Capture: thoughts land in the Inbox, nothing but a title ---- */

const INBOX = [
  "Renew passport",
  "Call the landlord about the deposit",
  "Draft the Q3 investor update before Friday",
  "Book the moving van",
  "Spanish lesson 12",
];

function Slot({ p, from, to, children, className, dx = "105%" }: { p: MotionValue<number>; from: number; to: number; children: ReactNode; className?: string; dx?: string }) {
  const x = useTransform(p, [from, to], [dx, "0%"]);
  return (
    <motion.div className={className} style={{ x }}>
      {children}
    </motion.div>
  );
}

function CaptureGraphic({ p }: { p: MotionValue<number> }) {
  const count = useTransform(p, (v) => String(Math.max(0, Math.min(INBOX.length, Math.round(v * INBOX.length + 0.2)))));
  return (
    <div aria-hidden className="select-none border border-[var(--line-2)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--line-2)] px-4 py-3">
        <span className="text-[15px] font-bold tracking-[-0.02em]">Inbox</span>
        <motion.span className="d4-mono bg-[var(--amber)] px-1.5 text-[12px] font-semibold text-[#1a1100]">{count}</motion.span>
      </div>
      <div className="flex h-12 items-center gap-3 border-b border-[var(--line)] px-4 text-[14px] text-[var(--faint)]">
        <span className="flex size-6 items-center justify-center bg-[var(--ink)] font-bold text-[#0a0a0a]">+</span>
        Type a thought and press Enter
      </div>
      <ul className="overflow-hidden">
        {INBOX.map((item, index) => (
          <li key={item} className="h-12 overflow-hidden border-b border-[var(--line)] last:border-b-0">
            <Slot p={p} from={index / INBOX.length - 0.05} to={(index + 1) / INBOX.length - 0.08} className="flex h-full items-center gap-3 px-4">
              <span className="size-3.5 shrink-0 border border-[var(--line-2)]" />
              <span className="truncate text-[14px] font-medium">{item}</span>
              <span className="d4-mono ml-auto shrink-0 text-[11px] text-[var(--faint)]">just now</span>
            </Slot>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- 2 · Clarify: each item becomes Work (with a length) or a Reminder (at a time) ---- */

const SORT: { title: string; kind: "work" | "reminder"; meta: string; color: ColorName }[] = [
  { title: "Draft the Q3 investor update", kind: "work", meta: "2h · Fundraising", color: "green" },
  { title: "Renew passport", kind: "reminder", meta: "Mon 12 · 09:00", color: "orange" },
  { title: "Book the moving van", kind: "work", meta: "20m · Move to the new flat", color: "green" },
  { title: "Call the landlord", kind: "reminder", meta: "Tue 13 · 17:30", color: "orange" },
  { title: "Spanish lesson 12", kind: "work", meta: "45m · Learn Spanish", color: "amber" },
];

function SortedCard({ p, index, item }: { p: MotionValue<number>; index: number; item: (typeof SORT)[number] }) {
  const start = 0.1 + index * 0.15;
  const x = useTransform(p, [start, start + 0.18], [item.kind === "work" ? "50%" : "-50%", "0%"]);
  const fill = useTransform(p, [start + 0.12, start + 0.2], [0, 1]);
  return (
    <motion.div className="relative h-[58px] overflow-hidden border border-[var(--line-2)] bg-[var(--bg)] px-3 py-2" style={{ x }}>
      <motion.span className="absolute inset-y-0 left-0 w-1" style={{ background: C[item.color].bg, scaleY: fill, originY: 0 }} />
      <p className="truncate text-[13px] font-semibold">{item.title}</p>
      <p className="d4-mono mt-1 truncate text-[11px] text-[var(--soft)]">{item.meta}</p>
    </motion.div>
  );
}

function ClarifyGraphic({ p }: { p: MotionValue<number> }) {
  const work = SORT.filter((item) => item.kind === "work");
  const reminders = SORT.filter((item) => item.kind === "reminder");
  return (
    <div aria-hidden className="grid select-none grid-cols-2 border border-[var(--line-2)] bg-[var(--panel)]">
      {[
        { label: "Work", note: "Takes time: a length and a workspace", items: work, color: "pink" as const },
        { label: "Reminder", note: "A ping at a set time", items: reminders, color: "orange" as const },
      ].map((column, columnIndex) => (
        <div key={column.label} className={cn("min-w-0 p-3 sm:p-4", columnIndex === 0 && "border-r border-[var(--line-2)]")}>
          <p className="flex items-center gap-2">
            <span className="size-3" style={{ background: C[column.color].bg }} />
            <span className="text-[17px] font-bold tracking-[-0.03em]">{column.label}</span>
          </p>
          <p className="mt-1 min-h-[2.4em] text-[11.5px] leading-snug text-[var(--soft)]">{column.note}</p>
          <div className="mt-3 flex flex-col gap-2">
            {column.items.map((item) => (
              <SortedCard key={item.title} p={p} index={SORT.indexOf(item)} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- 3 · Auto-schedule: Work slides off the waiting list into free time ---- */

const GRID_EVENTS = [
  { day: 0, from: 0, to: 0.12, title: "Weekly planning" },
  { day: 1, from: 0.18, to: 0.34, title: "Client review" },
  { day: 2, from: 0.42, to: 0.56, title: "Lunch with Sam" },
  { day: 3, from: 0.62, to: 0.78, title: "Dentist" },
];

const GRID_WORK: { day: number; from: number; to: number; title: string; color: ColorName }[] = [
  { day: 0, from: 0.16, to: 0.42, title: "Launch brief 1/2", color: "violet" },
  { day: 1, from: 0.0, to: 0.12, title: "Spanish 12", color: "amber" },
  { day: 1, from: 0.36, to: 0.42, title: "Moving van", color: "green" },
  { day: 2, from: 0.58, to: 0.72, title: "Launch budget", color: "blue" },
  { day: 3, from: 0.16, to: 0.42, title: "Launch brief 2/2", color: "violet" },
  { day: 3, from: 0.8, to: 0.88, title: "Invoices", color: "pink" },
  { day: 4, from: 0.08, to: 0.3, title: "Northwind proposal", color: "cyan" },
];

function PlacedBlock({ p, index, block }: { p: MotionValue<number>; index: number; block: (typeof GRID_WORK)[number] }) {
  const start = 0.08 + index * 0.1;
  const x = useTransform(p, [start, start + 0.16], [`${(5 - block.day) * 100 + 40}%`, "0%"]);
  return (
    <motion.span
      className="absolute overflow-hidden px-1.5 py-1"
      style={{
        x,
        left: `calc(${block.day} * 20% + 2px)`,
        width: "calc(20% - 4px)",
        top: `${block.from * 100}%`,
        height: `max(16px, ${(block.to - block.from) * 100}%)`,
        background: C[block.color].bg,
        color: C[block.color].ink,
      }}
    >
      <span className="block truncate text-[10.5px] leading-tight font-bold">{block.title}</span>
    </motion.span>
  );
}

function ScheduleGraphic({ p }: { p: MotionValue<number> }) {
  const placed = useTransform(p, (v) => String(Math.max(0, Math.min(GRID_WORK.length, Math.floor((v - 0.08) / 0.1 + 0.6)))));
  const applyBg = useTransform(p, [0.86, 0.92], ["#f3f2ed", "#30a66d"]);
  return (
    <div aria-hidden className="select-none overflow-hidden border border-[var(--line-2)] bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] px-3 py-2.5 sm:px-4">
        <span className="text-[15px] font-bold tracking-[-0.02em]">Auto-schedule · preview</span>
        <span className="d4-mono text-[11.5px] text-[var(--soft)]">
          added <motion.span className="font-semibold text-[var(--ink)]">{placed}</motion.span>
          <span className="hidden sm:inline"> · couldn&apos;t place 0</span>
        </span>
      </div>
      <div className="grid grid-cols-5 border-b border-[var(--line)] text-[10.5px] font-semibold text-[var(--faint)]">
        {["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"].map((day) => (
          <span key={day} className="border-r border-[var(--line)] px-1.5 py-1.5 last:border-r-0">
            {day}
          </span>
        ))}
      </div>
      <div className="relative h-[230px] overflow-hidden sm:h-[260px]">
        {[1, 2, 3, 4].map((day) => (
          <span key={day} className="absolute inset-y-0 border-l border-[var(--line)]" style={{ left: `${day * 20}%` }} />
        ))}
        {GRID_EVENTS.map((event) => (
          <span
            key={event.title}
            className="d4-event absolute overflow-hidden px-1.5 py-1"
            style={{ left: `calc(${event.day} * 20% + 2px)`, width: "calc(20% - 4px)", top: `${event.from * 100}%`, height: `${(event.to - event.from) * 100}%` }}
          >
            <span className="block truncate text-[10.5px] leading-tight font-semibold">{event.title}</span>
          </span>
        ))}
        {GRID_WORK.map((block, index) => (
          <PlacedBlock key={block.title} p={p} index={index} block={block} />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--line-2)] px-3 py-2.5 sm:px-4">
        <span className="inline-flex h-8 items-center border border-[var(--line-2)] px-3 text-[12px] text-[var(--soft)]">Undo last apply</span>
        <motion.span className="inline-flex h-8 items-center px-3 text-[12px] font-semibold text-[#0a0a0a]" style={{ background: applyBg }}>
          Apply schedule
        </motion.span>
      </div>
    </div>
  );
}

/* ---- 4 · Focus: the session counts toward the task ---- */

const FOCUS_LIST = [
  { title: "Write the launch brief", time: "10:00–12:00", color: "violet" as const },
  { title: "Build the launch budget", time: "13:05–14:05", color: "blue" as const },
  { title: "Spanish lesson 12", time: "16:00–16:45", color: "amber" as const },
];

function FocusGraphic({ p }: { p: MotionValue<number> }) {
  const minutes = useTransform(p, [0.05, 0.95], [0, 47]);
  const timer = useTransform(minutes, (m) => {
    const total = Math.round(m * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
  const actual = useTransform(minutes, (m) => `${Math.floor((25 + m) / 60)}h ${String(Math.round(25 + m) % 60).padStart(2, "0")}m`);
  const bar = useTransform(p, [0.05, 0.95], [0.21, 0.6]);
  const today = useTransform(p, [0.05, 0.95], [0.25, 0.7]);
  return (
    <div aria-hidden className="select-none border border-[var(--line-2)] bg-[var(--panel)]">
      <div className="border-b border-[var(--line-2)] px-4 py-3">
        <p className="d4-label text-[10px] text-[var(--faint)]">Today · Mon 12 Oct</p>
        <p className="mt-0.5 text-[15px] font-bold tracking-[-0.02em]">Today focus</p>
      </div>
      <ul>
        {FOCUS_LIST.map((item, index) => (
          <li key={item.title} className="flex h-12 items-center gap-3 border-b border-[var(--line)] px-4">
            <span className="h-6 w-1 shrink-0" style={{ background: C[item.color].bg }} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{item.title}</span>
            <span className="d4-mono hidden shrink-0 text-[11px] text-[var(--faint)] sm:inline">{item.time}</span>
            <span
              className={cn(
                "inline-flex h-7 shrink-0 items-center px-2.5 text-[11.5px] font-semibold",
                index === 0 ? "bg-[var(--green)] text-[#06150d]" : "border border-[var(--line-2)] text-[var(--soft)]",
              )}
            >
              {index === 0 ? "In focus" : "Start Focus"}
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 px-4 pt-4 pb-4">
        <div className="min-w-0">
          <p className="text-[12px] text-[var(--soft)]">Write the launch brief</p>
          <motion.p className="d4-num mt-1 text-[56px] sm:text-[68px]">{timer}</motion.p>
          <div className="mt-3 h-2 bg-[rgb(243_242_237/10%)]">
            <motion.div className="h-full bg-[var(--green)]" style={{ scaleX: bar, originX: 0 }} />
          </div>
          <p className="d4-mono mt-1.5 text-[11px] text-[var(--soft)]">
            actual <motion.span className="text-[var(--ink)]">{actual}</motion.span> of 2h
          </p>
        </div>
        <div className="w-[104px] border border-[var(--line-2)] p-2.5 sm:w-[124px]">
          <p className="text-[10.5px] font-semibold">Focus time</p>
          <div className="mt-2 flex h-14 items-end gap-1">
            {[0.55, 0.8, 0.35, 0.62].map((value, index) => (
              <span key={index} className="flex-1 bg-[rgb(243_242_237/22%)]" style={{ height: `${value * 100}%` }} />
            ))}
            <motion.span className="flex-1 bg-[var(--green)]" style={{ height: "100%", scaleY: today, originY: 1 }} />
          </div>
          <p className="d4-mono mt-1 text-[9.5px] text-[var(--faint)]">Wed–Mon</p>
        </div>
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    key: "capture",
    name: "Capture",
    color: "amber",
    day: "Any moment",
    body: "Type a thought into the Inbox the moment it shows up. It needs nothing but a title.",
    detail: "On the desktop, the phone, or by asking the assistant.",
    Graphic: CaptureGraphic,
  },
  {
    key: "clarify",
    name: "Clarify",
    color: "pink",
    day: "Once a day",
    body: "Later, decide what each item is: Work, which takes time and gets a length and a workspace, or a Reminder, a ping at a set time.",
    detail: "Smart suggestions fill in project, labels and dates as you go.",
    Graphic: ClarifyGraphic,
  },
  {
    key: "schedule",
    name: "Auto-schedule",
    color: "violet",
    day: "One click",
    body: "Timely places your Work as blocks in free time inside your working hours, most urgent first, around your events.",
    detail: "Read the preview, then Apply schedule. Undo last apply puts it all back.",
    Graphic: ScheduleGraphic,
  },
  {
    key: "focus",
    name: "Focus",
    color: "green",
    day: "Right now",
    body: "Today shows what is next. Start Focus on a task and the minutes count toward its actual time.",
    detail: "They also add up in the Dashboard’s Focus time card.",
    Graphic: FocusGraphic,
  },
];

function StepText({ step, index, big = false }: { step: Step; index: number; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-end gap-4">
        <span className={cn("d4-num", big ? "text-[11rem] xl:text-[14rem]" : "text-[7.5rem] sm:text-[9rem]")} style={{ color: C[step.color].bg }} aria-hidden>
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="d4-label mb-2 text-[var(--faint)]">{step.day}</span>
      </div>
      <h3 className="mt-5 text-[2.6rem] leading-[0.92] font-extrabold tracking-[-0.05em] sm:text-[3.5rem] xl:text-[4.25rem]">
        <span className="sr-only">{`Step ${index + 1}: `}</span>
        {step.name}
      </h3>
      <p className="d4-lead mt-5 max-w-[34ch] text-[var(--ink)]">{step.body}</p>
      <p className="d4-body mt-3 max-w-[38ch]">{step.detail}</p>
    </div>
  );
}

/** Phones, tablets and reduced motion: the four steps stacked, each assembling as it scrolls into view. */
function StackedStep({ step, index }: { step: Step; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.95", "center 0.55"] });
  const full = useMotionValue(1);
  return (
    <div ref={ref} className="grid gap-8 border-t border-[var(--line-2)] py-10 md:grid-cols-12 md:gap-0 md:py-14">
      <div className="md:col-span-5 md:pr-8">
        <StepText step={step} index={index} />
      </div>
      <div className="md:col-span-7">
        <step.Graphic p={reduced ? full : scrollYProgress} />
      </div>
    </div>
  );
}

function PinnedPanel({ step, index, progress }: { step: Step; index: number; progress: MotionValue<number> }) {
  const last = STEPS.length - 1;
  // Panel 0 is already on screen when pinning starts, so it assembles a little earlier.
  const range = index === 0 ? [-0.2, 0.12] : [(index - 0.85) / last, (index - 0.08) / last];
  const p = useTransform(progress, range, [0, 1], { clamp: true });
  return (
    <article className="grid h-full w-[min(1180px,84vw)] shrink-0 grid-cols-12 items-center border-l border-[var(--line-2)] px-10 first:border-l-0 first:pl-0 xl:px-14">
      <div className="col-span-5 pr-8">
        <StepText step={step} index={index} big />
      </div>
      <div className="col-span-7">
        <step.Graphic p={p} />
      </div>
    </article>
  );
}

function Pinned() {
  const outer = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () => setDistance(Math.max(0, element.scrollWidth - element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({ target: outer, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 260, damping: 40, mass: 0.4 });
  const x = useTransform(smooth, (v) => -v * distance);
  const ruler = useTransform(smooth, [0, 1], [1 / STEPS.length, 1]);

  return (
    <div ref={outer} data-d4-pin className="relative" style={{ height: `calc(100vh - var(--head) + ${distance}px)` }}>
      <div className="sticky top-[var(--head)] flex h-[calc(100vh-var(--head))] flex-col overflow-hidden">
        <div className="d4-wrap">
          <div className="relative grid grid-cols-4 border-b border-[var(--line-2)]">
            {STEPS.map((step, index) => (
              <span key={step.key} className="flex h-12 items-center gap-2 text-[13px] font-semibold">
                <span className="d4-mono text-[11px] text-[var(--faint)]">{String(index + 1).padStart(2, "0")}</span>
                {step.name}
              </span>
            ))}
            <motion.span className="absolute bottom-[-1px] left-0 h-[3px] w-full bg-[var(--ink)]" style={{ scaleX: ruler, originX: 0 }} />
          </div>
        </div>
        <div className="d4-wrap min-h-0 flex-1 !pr-0">
          <motion.div ref={track} className="flex h-full overflow-visible" style={{ x }}>
            {STEPS.map((step, index) => (
              <PinnedPanel key={step.key} step={step} index={index} progress={smooth} />
            ))}
            <div className="w-[var(--pad)] shrink-0" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/**
 * How it works: on a desktop the section pins and the week runs sideways,
 * Capture to Focus, as you scroll. Elsewhere the steps stack.
 */
export default function LoopPinned() {
  const reduced = useReduced();
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (min-height: 700px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (wide && !reduced) return <Pinned />;
  return (
    <div className="d4-wrap">
      {STEPS.map((step, index) => (
        <StackedStep key={step.key} step={step} index={index} />
      ))}
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "./hooks";
import { Hand, Stamp, Strike } from "./ink";

const START = 9 * 60;
const END = 17 * 60 + 30;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

const EVENTS = [
  { title: "Weekly planning", start: 540, end: 585 },
  { title: "Lunch with Sam", start: 720, end: 780 },
  { title: "Dentist", start: 840, end: 900 },
];

const WORK = [
  { note: "write the launch brief ~ 1½h", width: 229, title: "Write the launch brief", start: 600, end: 690, length: "1h 30m" },
  { note: "send Oct invoices, 30 min", width: 195, title: "Send October invoices", start: 780, end: 810, length: "30m" },
  { note: "book the moving van (20m)", width: 210, title: "Book the moving van", start: 915, end: 935, length: "20m" },
];

// blank · write ×3 · press Auto-schedule · set ×3 · stamp (then the page turns)
const TIMING = [1100, 1500, 1250, 1250, 950, 650, 650, 900, 3000];

const pct = (minutes: number) => `${((minutes - START) / (END - START)) * 100}%`;
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function PlannerSheet({ frame }: { frame: number }) {
  const pressed = frame >= 4;
  const stamped = frame >= 8;
  return (
    <div className="d2-sheet relative flex h-full flex-col overflow-hidden px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
      {/* Running head */}
      <div className="flex items-end justify-between gap-3 border-b-[3px] border-double border-[var(--rule-3)] pb-2">
        <p className="d2-serif text-[1.65rem] leading-none sm:text-[2rem]">
          Monday <span className="text-[var(--ink-3)] italic">12 October</span>
        </p>
        <p className="d2-mono text-right text-[10px] leading-tight tracking-wider text-[var(--ink-3)] uppercase">
          Week 42
          <br />
          2026
        </p>
      </div>

      {/* Inbox: handwritten capture */}
      <div className="relative mt-3 border-l-2 border-[var(--verm)]/60 pl-3">
        <p className="d2-mono text-[10px] tracking-[0.14em] text-[var(--ink-3)] uppercase">Inbox · to place</p>
        <ul className="mt-0.5">
          {WORK.map((item, index) => {
            const placed = frame >= 5 + index;
            return (
              <li key={item.note} className={cn("relative h-[27px] text-[var(--ink)] transition-opacity duration-500 sm:h-[29px]", placed && "opacity-55")}>
                <Hand text={item.note} on={frame >= index + 1} width={item.width} size={22} duration={index === 0 ? 1.25 : 1} />
                <Strike on={placed} className="top-[11px] left-[-2px] h-2.5" style={{ width: item.width - 6 }} delay={0.05} />
              </li>
            );
          })}
        </ul>
      </div>

      {/* The day */}
      <div className="relative mt-3 flex-1">
        <div className="relative ml-11 h-full border-l border-[var(--rule-2)] sm:ml-12">
          {HOURS.map((hour) => (
            <div key={hour} className="absolute inset-x-0 border-t border-[var(--rule)]" style={{ top: pct(hour * 60) }}>
              <span className="d2-mono absolute -top-[7px] -left-11 w-9 text-right text-[10px] text-[var(--ink-3)] sm:-left-12 sm:w-10">
                {clock(hour * 60)}
              </span>
            </div>
          ))}

          {EVENTS.map((event) => (
            <div
              key={event.title}
              className="d2-hatch absolute right-7 left-1.5 flex items-start border border-[var(--rule-3)] px-2 pt-0.5 text-[11px] leading-tight text-[var(--ink-2)]"
              style={{ top: pct(event.start), height: `calc(${pct(event.end)} - ${pct(event.start)})` }}
            >
              <span className="d2-mono mr-1.5 text-[10px] text-[var(--ink-3)]">{clock(event.start)}</span>
              <span className="truncate">{event.title}</span>
            </div>
          ))}

          {WORK.map((item, index) => {
            const placed = frame >= 5 + index;
            return (
              <motion.div
                key={item.title}
                initial={false}
                animate={{ clipPath: placed ? "inset(0% 0% 0% 0%)" : "inset(0% 100% 0% 0%)" }}
                transition={{ duration: 0.45, ease: [0.65, 0, 0.35, 1] }}
                className="absolute right-7 left-1.5 flex min-h-[22px] items-start gap-1.5 bg-[var(--ink)] px-2 pt-[3px] text-[11.5px] leading-tight font-medium text-[var(--paper)]"
                style={{ top: pct(item.start), height: `calc(${pct(item.end)} - ${pct(item.start)})` }}
              >
                <span className="d2-mono text-[10px] opacity-70">{clock(item.start)}</span>
                <span className="truncate">{item.title}</span>
                <span className="d2-mono ml-auto hidden text-[10px] opacity-60 sm:inline">{item.length}</span>
              </motion.div>
            );
          })}

          {/* Working hours bracket */}
          <div className="absolute top-0 right-0 bottom-0 w-4 border-y border-r border-[var(--verm)]/70">
            <span className="d2-mono absolute top-1/2 left-[calc(100%+7px)] origin-left -translate-y-1/2 rotate-90 text-[9px] tracking-wider whitespace-nowrap text-[var(--verm-2)] uppercase">
              <span className="relative -left-[50%]">working hours</span>
            </span>
          </div>

          <Stamp on={stamped} className="right-9 bottom-[13%] px-3 pt-2 pb-1.5 text-center sm:right-14">
            <span className="block text-[1.7rem] sm:text-[2rem]">Scheduled</span>
            <span className="d2-mono mt-1 block text-[9px] font-medium tracking-[0.2em]">Mon 12 Oct · 3 placed</span>
          </Stamp>
        </div>
      </div>

      {/* Auto-schedule bar */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--rule-2)] pt-2.5">
        <motion.span
          initial={false}
          animate={pressed && frame === 4 ? { scale: [1, 0.93, 1] } : { scale: 1 }}
          transition={{ duration: 0.35 }}
          className={cn(
            "d2-mono inline-flex h-7 items-center gap-1.5 border px-2.5 text-[11px] transition-colors duration-300",
            pressed ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--rule-3)] text-[var(--ink)]",
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M1 3h10M1 6h6M1 9h8" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          Auto-schedule
        </motion.span>
        <span className="d2-mono text-[10.5px] text-[var(--ink-3)]">
          {stamped ? "3 placed · Undo" : pressed ? "placing…" : `${Math.min(frame, 3)} to place`}
        </span>
      </div>
    </div>
  );
}

/**
 * The hero figure: notes are written into the Inbox by hand, Auto-schedule
 * typesets them into free time around the day's meetings, a stamp lands,
 * and the page turns to start again.
 */
export default function HeroPage() {
  const { ref, frame, cycle } = useLoop(TIMING.length, TIMING, TIMING.length - 1, 0);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A planner page for Monday 12 October. Three handwritten notes, write the launch brief, send October invoices and book the moving van, are placed by Auto-schedule at 10:00, 13:00 and 15:15, around Weekly planning, Lunch with Sam and the dentist, and stamped Scheduled."
      className="relative mr-[8px] w-[calc(100%-8px)] max-w-[532px] [perspective:2200px] lg:mx-auto"
    >
      {/* Page edges under the top sheet */}
      <div aria-hidden className="absolute inset-0 translate-x-[7px] translate-y-[7px] border border-[var(--rule-2)] bg-[var(--paper-2)]" />
      <div aria-hidden className="absolute inset-0 translate-x-[3.5px] translate-y-[3.5px] border border-[var(--rule-2)] bg-[var(--paper-3)]" />
      <div className="relative h-[540px] sm:h-[590px]">
        <AnimatePresence initial={false}>
          <motion.div
            key={cycle}
            className="absolute inset-0 [backface-visibility:hidden]"
            style={{ transformOrigin: "left center", zIndex: 1 }}
            exit={{
              rotateY: -105,
              opacity: [1, 1, 0],
              zIndex: 5,
              transition: { duration: 1.1, ease: [0.55, 0, 0.3, 1], opacity: { duration: 1.1, times: [0, 0.75, 1] } },
            }}
          >
            <PlannerSheet frame={frame} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

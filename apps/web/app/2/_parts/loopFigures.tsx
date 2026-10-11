"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "./hooks";
import { Hand, Stamp, Strike } from "./ink";

/** Sub-step of the active column (0–2); null means "show the finished state". */
type T = number | null;

const ease = [0.65, 0, 0.35, 1] as const;

function CaptureFig({ t }: { t: T }) {
  const on = t === null || t >= 1;
  return (
    <div className="d2-ruled h-full border border-[var(--rule-2)] bg-[var(--sheet)] px-3 pt-2">
      <p className="d2-mono text-[10px] tracking-widest text-[var(--ink-3)] uppercase">Inbox</p>
      <div className="mt-[7px] h-8 text-[var(--ink)]">
        <Hand text="write the launch brief" on={on} width={196} size={23} duration={0.9} />
      </div>
      <p className="h-8 text-[13px] leading-8 text-[var(--ink-2)]">Book the moving van</p>
      <p className="h-8 text-[13px] leading-8 text-[var(--ink-2)]">Send October invoices</p>
    </div>
  );
}

const FIELDS = ["Work", "1h 30m", "due Tue 13 Oct", "Website refresh"];

function ClarifyFig({ t }: { t: T }) {
  const count = t === null ? 4 : t === 0 ? 0 : t === 1 ? 2 : 4;
  return (
    <div className="h-full border border-[var(--rule-2)] bg-[var(--sheet)] p-3">
      <p className="d2-serif text-[15px] leading-tight">Write the launch brief</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {FIELDS.map((field, index) => (
          <motion.li
            key={field}
            initial={false}
            animate={{ clipPath: index < count ? "inset(0% 0% 0% 0%)" : "inset(0% 100% 0% 0%)" }}
            transition={{ duration: 0.35, delay: index < count ? (index % 2) * 0.2 : 0, ease }}
            className={cn(
              "d2-mono border px-1.5 py-0.5 text-[10.5px]",
              index === 0 ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--rule-3)] text-[var(--ink)]",
            )}
          >
            {field}
          </motion.li>
        ))}
      </ul>
      <p className="d2-mono mt-3 text-[10px] text-[var(--ink-3)]">Inbox → Work</p>
    </div>
  );
}

function ScheduleFig({ t }: { t: T }) {
  const placed = t === null || t >= 1;
  const stamped = t === null || t >= 2;
  return (
    <div className="relative h-full overflow-hidden border border-[var(--rule-2)] bg-[var(--sheet)] p-3 pl-11">
      {["09", "10", "11", "12"].map((hour, index) => (
        <span key={hour} className="absolute inset-x-0 border-t border-[var(--rule)]" style={{ top: `${14 + index * 24}%` }}>
          <span className="d2-mono absolute -top-2 left-2 text-[10px] text-[var(--ink-3)]">{hour}:00</span>
        </span>
      ))}
      <span className="d2-hatch absolute right-3 left-11 border border-[var(--rule-3)] px-1.5 text-[10px] text-[var(--ink-2)]" style={{ top: "14%", height: "18%" }}>
        Weekly planning
      </span>
      <span className="d2-hatch absolute right-3 left-11 border border-[var(--rule-3)] px-1.5 text-[10px] text-[var(--ink-2)]" style={{ top: "86%", height: "20%" }}>
        Lunch with Sam
      </span>
      <motion.span
        initial={false}
        animate={placed ? { top: "38%", rotate: 0 } : { top: "-30%", rotate: -3 }}
        transition={placed ? { type: "spring", stiffness: 240, damping: 22 } : { duration: 0 }}
        className="absolute right-3 left-11 h-[36%] bg-[var(--ink)] px-1.5 pt-0.5 text-[10.5px] leading-tight font-medium text-[var(--paper)]"
      >
        <span className="d2-mono mr-1 opacity-70">10:00</span>Write the launch brief
      </motion.span>
      <Stamp on={stamped} angle={-10} className="right-2 bottom-[16%] px-1.5 pt-1 pb-0.5 !text-[13px] !tracking-[0.1em]">
        Scheduled
      </Stamp>
    </div>
  );
}

function FocusFig({ t }: { t: T }) {
  const fill = t === null ? 1 : t === 0 ? 0.15 : 1;
  const done = t === null || t >= 2;
  return (
    <div className="h-full border border-[var(--rule-2)] bg-[var(--sheet)] p-3">
      <p className="d2-mono flex justify-between text-[10px] text-[var(--ink-3)] uppercase">
        <span>Today · now</span>
        <span>10:00–11:30</span>
      </p>
      <p className={cn("relative mt-2 w-fit text-[14px] font-medium transition-opacity duration-500", done && "opacity-70")}>
        Write the launch brief
        <Strike on={done} className="top-[8px] left-0 h-2.5 w-full" />
      </p>
      <div className="mt-3 h-3 border border-[var(--rule-3)] p-[2px]">
        <motion.div
          initial={false}
          animate={{ scaleX: fill }}
          transition={{ duration: t === 1 ? 1.1 : 0.3, ease: "linear" }}
          className="d2-hatch h-full origin-left bg-[var(--ink-2)]/50"
        />
      </div>
      <p className="d2-mono mt-2 text-[10px] text-[var(--ink-2)]">{done ? "1h 30m focused · done" : "focus session running"}</p>
    </div>
  );
}

const STEPS = [
  {
    label: "Capture",
    title: "Get it out of your head.",
    body: "Type a thought into the Inbox the moment it shows up. No project, no date, no length yet. The phone's Quick Add drops into the same Inbox.",
    href: "/help/plan/inbox",
    read: "Capture and Clarify",
    Fig: CaptureFig,
  },
  {
    label: "Clarify",
    title: "Decide what each thing is.",
    body: "Turn an item into Work with a length and a space, or a Reminder with a time. Suggestions can fill in the project, labels and dates.",
    href: "/help/plan/inbox",
    read: "Capture and Clarify",
    Fig: ClarifyFig,
  },
  {
    label: "Auto-schedule",
    title: "Let the week arrange itself.",
    body: "Timely places Work inside your working hours and around your events, by deadline and priority. Preview, apply, or undo the last run.",
    href: "/help/plan/auto-schedule",
    read: "Auto-schedule",
    Fig: ScheduleFig,
  },
  {
    label: "Focus",
    title: "Do the next thing.",
    body: "Today shows your focus list, habits and goals, and what is on the clock. Start a focus session and the time counts toward the task.",
    href: "/help/plan/today",
    read: "Today, focus, habits and goals",
    Fig: FocusFig,
  },
];

/**
 * The loop as four printed columns. While on screen, one thought travels
 * through them in turn; every column rests on its finished state.
 */
export default function LoopColumns() {
  const { ref, frame, reduced } = useLoop(12, [500, 1200, 1300], 0, 11);
  const step = reduced ? -1 : Math.floor(frame / 3);
  const sub = frame % 3;
  return (
    <div ref={ref} className="mt-12">
      {/* The route line */}
      <div aria-hidden className="relative mb-6 hidden h-px bg-[var(--rule-2)] lg:block">
        <motion.span
          className="absolute inset-y-0 left-0 bg-[var(--verm)]"
          initial={false}
          animate={{ width: reduced ? "100%" : `${((step + (sub + 1) / 3) / 4) * 100}%` }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
        />
      </div>
      <ol className="grid gap-y-12 md:grid-cols-2 md:gap-x-8 lg:grid-cols-4 lg:gap-x-0">
        {STEPS.map((item, index) => {
          const active = index === step;
          return (
            <li key={item.label} className="flex min-w-0 flex-col lg:border-l lg:border-[var(--rule)] lg:px-6 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0">
              <p className="flex items-baseline gap-3">
                <span
                  className={cn(
                    "d2-serif text-[2.6rem] leading-none italic transition-colors duration-500",
                    active ? "text-[var(--verm-2)]" : "text-[var(--ink-3)]",
                  )}
                >
                  {index + 1}
                </span>
                <span className="d2-kicker">{item.label}</span>
              </p>
              <h3 className="d2-serif mt-3 text-[1.5rem] leading-tight lg:min-h-[2.5em]">{item.title}</h3>
              <p className="d2-soft mt-2 text-[0.97rem] leading-relaxed">{item.body}</p>
              <div aria-hidden className="mt-5 h-[150px]">
                <item.Fig t={active ? sub : null} />
              </div>
              <Link href={item.href} className="d2-link mt-4 w-fit text-sm">
                Read: {item.read}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

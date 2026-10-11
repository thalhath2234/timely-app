"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, Inbox, Sparkles, Timer } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "@/app/_components/site/motion";

/**
 * The hero's motion graphic: one pass of Timely's loop. Loose thoughts float
 * in (Capture), line up as Work with a length and a space (Clarify), fly onto
 * the week around existing events (Auto-schedule), and the first block starts
 * a focus session (Focus). Then it starts over.
 */

const PHASES = ["Capture", "Clarify", "Auto-schedule", "Focus"] as const;
const DURATIONS = [2800, 2800, 3400, 3600] as const;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_START = 9;
const HOURS = 8;

// Calendar area of the stage, in % of the stage box.
const CAL = { left: 45, right: 97, top: 21, bottom: 95 };
const COL = (CAL.right - CAL.left) / DAYS.length;
const HOUR = (CAL.bottom - CAL.top) / HOURS;

type Item = {
  id: string;
  thought: string;
  title: string;
  length: string;
  space: string;
  color: string;
  reminder?: boolean;
  /** Where the thought floats during Capture: left/top in %, tilt in deg. */
  float: { left: number; top: number; tilt: number };
  /** Where Auto-schedule puts it: day index, start hour, hours. */
  block: { day: number; start: number; hours: number; time: string };
};

const ITEMS: Item[] = [
  {
    id: "brief",
    thought: "write the launch brief before tue",
    title: "Write the launch brief",
    length: "1h 30m",
    space: "Studio",
    color: "#c0c1ff",
    float: { left: 6, top: 30, tilt: -4 },
    block: { day: 0, start: 10, hours: 1.5, time: "10:00" },
  },
  {
    id: "van",
    thought: "book a moving van!!",
    title: "Book the moving van",
    length: "20m",
    space: "Personal",
    color: "#4edea3",
    float: { left: 54, top: 26, tilt: 3 },
    block: { day: 1, start: 9, hours: 0.75, time: "09:00" },
  },
  {
    id: "home",
    thought: "homepage design, needs a full morning",
    title: "Design the homepage",
    length: "3h",
    space: "Studio",
    color: "#f0abfc",
    float: { left: 14, top: 52, tilt: 2 },
    block: { day: 2, start: 9, hours: 3, time: "09:00" },
  },
  {
    id: "mum",
    thought: "call mum friday at 4",
    title: "Call mum",
    length: "Fri 16:00",
    space: "Reminder",
    color: "#ffb95f",
    reminder: true,
    float: { left: 60, top: 60, tilt: -3 },
    block: { day: 4, start: 16, hours: 0.5, time: "16:00" },
  },
  {
    id: "spanish",
    thought: "spanish lesson 12",
    title: "Spanish lesson",
    length: "45m",
    space: "Personal",
    color: "#7cc4ff",
    float: { left: 30, top: 74, tilt: 4 },
    block: { day: 3, start: 13.5, hours: 1, time: "13:30" },
  },
];

const EVENTS = [
  { title: "Planning", day: 0, start: 9, hours: 0.75 },
  { title: "Client review", day: 1, start: 11, hours: 1 },
  { title: "Lunch with Sam", day: 2, start: 12.5, hours: 1 },
  { title: "Dentist", day: 3, start: 10, hours: 1 },
  { title: "Workshop", day: 4, start: 10, hours: 2.5 },
];

const spring = { type: "spring", stiffness: 140, damping: 22, mass: 1 } as const;

function blockBox(block: { day: number; start: number; hours: number }) {
  return {
    left: `${CAL.left + block.day * COL + 0.5}%`,
    top: `${CAL.top + (block.start - DAY_START) * HOUR + 0.3}%`,
    width: `${COL - 1}%`,
    height: `${block.hours * HOUR - 0.6}%`,
  };
}

function itemBox(item: Item, index: number, phase: number) {
  if (phase === 0) {
    return { left: `${item.float.left}%`, top: `${item.float.top}%`, width: "36%", height: "7.5%", rotate: item.float.tilt };
  }
  if (phase === 1) {
    return { left: "3.5%", top: `${30 + index * 12.5}%`, width: "38%", height: "10.5%", rotate: 0 };
  }
  return { ...blockBox(item.block), rotate: 0 };
}

export default function HeroFlow() {
  const { ref, frame: phase, cycle } = useLoop(PHASES.length, DURATIONS);

  return (
    <div ref={ref} className="relative">
      <div
        className="@container relative aspect-[16/11] w-full overflow-hidden rounded-[18px] border border-white/10 bg-[#111319] shadow-[0_40px_120px_-30px_rgba(129,131,244,0.45)] sm:aspect-[16/10]"
        role="img"
        aria-label="Animation: loose thoughts are captured, clarified into tasks, auto-scheduled onto a week calendar, and the first one starts a focus session."
      >
        {/* Window chrome */}
        <div className="absolute inset-x-0 top-0 flex h-[9%] items-center gap-[1.2cqw] border-b border-white/[0.06] px-[2.4cqw]">
          <span className="size-[1.3cqw] rounded-full bg-white/15" />
          <span className="size-[1.3cqw] rounded-full bg-white/15" />
          <span className="size-[1.3cqw] rounded-full bg-white/15" />
          <span className="ml-[1.5cqw] text-[1.7cqw] font-medium text-white/45">Timely</span>
          <span className="ml-auto flex items-center gap-[0.8cqw]">
            {PHASES.map((label, index) => (
              <span
                key={label}
                className={cn(
                  "rounded-full px-[1.2cqw] py-[0.35cqw] text-[1.45cqw] font-medium transition-colors duration-500",
                  index === phase ? "bg-[#c0c1ff] text-[#1000a9]" : "text-white/35",
                )}
              >
                {label}
              </span>
            ))}
          </span>
        </div>

        {/* Week calendar */}
        <div
          className="absolute"
          style={{ left: `${CAL.left}%`, right: `${100 - CAL.right}%`, top: "12%", bottom: `${100 - CAL.bottom}%` }}
        >
          <div className="grid h-[9%] grid-cols-5 text-center text-[1.45cqw] font-medium text-white/45">
            {DAYS.map((day, index) => (
              <span key={day}>
                {day} {12 + index}
              </span>
            ))}
          </div>
        </div>
        {Array.from({ length: HOURS + 1 }, (_, hour) => (
          <div
            key={hour}
            className="absolute h-px bg-white/[0.05]"
            style={{ left: `${CAL.left - 3}%`, right: `${100 - CAL.right}%`, top: `${CAL.top + hour * HOUR}%` }}
          >
            {hour % 2 === 0 ? (
              <span className="absolute -top-[0.9cqw] -left-[0.2cqw] text-[1.2cqw] text-white/25">
                {DAY_START + hour}
              </span>
            ) : null}
          </div>
        ))}
        {DAYS.map((day, index) => (
          <div
            key={day}
            className="absolute w-px bg-white/[0.05]"
            style={{ left: `${CAL.left + index * COL}%`, top: `${CAL.top - 7}%`, bottom: `${100 - CAL.bottom}%` }}
          />
        ))}
        {EVENTS.map((event) => (
          <div
            key={event.title}
            className="absolute overflow-hidden rounded-[0.8cqw] border border-white/[0.07] bg-white/[0.06] px-[0.8cqw] py-[0.5cqw] text-[1.3cqw] leading-tight text-white/45"
            style={blockBox(event)}
          >
            <span className="line-clamp-2">{event.title}</span>
          </div>
        ))}

        {/* Left panel: what the current step is doing */}
        <div className="absolute top-[13%] left-[3.5%] w-[38%]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              <PanelHeader phase={phase} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The items themselves, travelling between steps */}
        <AnimatePresence>
          {ITEMS.map((item, index) => (
            <motion.div
              key={`${item.id}-${cycle}`}
              className="absolute z-10"
              initial={{ ...itemBox(item, index, 0), opacity: 0, scale: 0.85 }}
              animate={{ ...itemBox(item, index, phase), opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.3 } }}
              transition={{
                ...spring,
                delay: phase === 0 ? 0.15 + index * 0.22 : phase === 2 ? 0.35 + index * 0.16 : index * 0.07,
                opacity: { duration: 0.35, delay: phase === 0 ? 0.15 + index * 0.22 : 0 },
              }}
            >
              <ItemFace item={item} phase={phase} focused={phase === 3 && item.id === "brief"} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Step strip under the window */}
      <div className="mt-5 grid grid-cols-4 gap-2 sm:gap-3" aria-hidden>
        {PHASES.map((label, index) => (
          <div key={label}>
            <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div
                key={`${index}-${cycle}-${phase === index}`}
                className="h-full rounded-full bg-[var(--s-primary)]"
                initial={{ width: index < phase ? "100%" : "0%" }}
                animate={{ width: index <= phase ? "100%" : "0%" }}
                transition={{ duration: index === phase ? DURATIONS[index] / 1000 : 0.3, ease: "linear" }}
              />
            </div>
            <p
              className={cn(
                "mt-2 text-xs font-medium transition-colors duration-500 sm:text-sm",
                index === phase ? "text-[var(--s-ink)]" : "text-[var(--s-faint)]",
              )}
            >
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({ phase }: { phase: number }) {
  if (phase === 0) {
    return (
      <div className="flex items-center gap-[1cqw] rounded-[1.2cqw] border border-white/10 bg-white/[0.04] px-[1.4cqw] py-[1cqw] text-[1.55cqw] text-white/50">
        <Inbox className="size-[2cqw] shrink-0 text-[#c0c1ff]" />
        Capture a thought…
        <span className="s-blink ml-[-0.6cqw] inline-block h-[2cqw] w-px bg-white/70" />
      </div>
    );
  }
  if (phase === 1) {
    return (
      <p className="flex items-center gap-[1cqw] text-[1.6cqw] font-semibold text-white/80">
        Clarify
        <span className="rounded-full bg-white/[0.07] px-[1cqw] py-[0.2cqw] text-[1.3cqw] font-medium text-white/50">
          5 ready to plan
        </span>
      </p>
    );
  }
  if (phase === 2) {
    return (
      <div className="rounded-[1.4cqw] border border-[#c0c1ff]/30 bg-[#c0c1ff]/[0.07] p-[1.6cqw]">
        <p className="flex items-center gap-[0.8cqw] text-[1.7cqw] font-semibold text-[#c0c1ff]">
          <Sparkles className="size-[2cqw]" />
          Auto-schedule
        </p>
        <p className="mt-[0.8cqw] text-[1.4cqw] leading-snug text-white/55">
          Placing 4 tasks inside working hours, around 5 events. 1 reminder.
        </p>
        <div className="mt-[1.2cqw] h-[0.5cqw] overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full bg-[#c0c1ff]"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          />
        </div>
      </div>
    );
  }
  return <FocusCard />;
}

function FocusCard() {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="rounded-[1.4cqw] border border-white/10 bg-white/[0.04] p-[1.6cqw]">
      <p className="flex items-center gap-[0.8cqw] text-[1.4cqw] font-medium tracking-wide text-[#4edea3] uppercase">
        <Timer className="size-[1.8cqw]" />
        Focusing
      </p>
      <div className="mt-[1.4cqw] flex items-center gap-[1.6cqw]">
        <svg viewBox="0 0 36 36" className="size-[8cqw] -rotate-90">
          <circle cx="18" cy="18" r={radius} fill="none" stroke="rgb(255 255 255 / 10%)" strokeWidth="3" />
          <motion.circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="#c0c1ff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * 0.35 }}
            transition={{ duration: 3, ease: "easeInOut" }}
          />
        </svg>
        <div className="min-w-0">
          <p className="truncate text-[1.7cqw] font-semibold text-white/90">Write the launch brief</p>
          <p className="mt-[0.4cqw] font-mono text-[2.4cqw] font-semibold text-white">
            <Countdown />
          </p>
        </div>
      </div>
    </div>
  );
}

function Countdown() {
  const { ref, frame } = useLoop(6, 600, 0);
  const seconds = 59 - frame;
  return <span ref={ref}>24:{String(seconds).padStart(2, "0")}</span>;
}

function ItemFace({ item, phase, focused }: { item: Item; phase: number; focused: boolean }) {
  return (
    <div className="relative h-full w-full">
      <AnimatePresence initial={false}>
        {phase === 0 ? (
          <Face key="thought">
            <div className="flex h-full items-center rounded-full border border-white/12 bg-[#1b1d26]/95 px-[1.6cqw] text-[1.5cqw] whitespace-nowrap text-white/75 shadow-lg shadow-black/30">
              <span className="truncate">{item.thought}</span>
            </div>
          </Face>
        ) : phase === 1 ? (
          <Face key="row">
            <div className="flex h-full items-center gap-[1.2cqw] rounded-[1.2cqw] border border-white/10 bg-[#191b22] px-[1.4cqw] shadow-lg shadow-black/30">
              <span className="h-[55%] w-[0.45cqw] shrink-0 rounded-full" style={{ background: item.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[1.55cqw] font-medium text-white/90">{item.title}</span>
                <span className="mt-[0.3cqw] flex items-center gap-[0.8cqw] text-[1.25cqw] text-white/45">
                  {item.reminder ? <Bell className="size-[1.3cqw]" /> : null}
                  {item.length}
                  <span className="size-[0.5cqw] rounded-full bg-white/25" />
                  {item.space}
                </span>
              </span>
            </div>
          </Face>
        ) : (
          <Face key="block">
            <div
              className={cn(
                "h-full overflow-hidden px-[0.8cqw] py-[0.5cqw] text-[1.3cqw] leading-tight transition-shadow duration-500",
                item.reminder ? "flex items-center rounded-full" : "rounded-[0.8cqw]",
              )}
              style={{
                background: `color-mix(in oklch, ${item.color} 24%, #15171e)`,
                borderLeft: item.reminder ? undefined : `0.45cqw solid ${item.color}`,
                boxShadow: focused ? `0 0 0 0.3cqw ${item.color}, 0 0 4cqw ${item.color}` : undefined,
                color: "rgb(255 255 255 / 92%)",
              }}
            >
              {item.reminder ? <Bell className="mr-[0.5cqw] size-[1.2cqw] shrink-0" /> : null}
              <span className={cn("font-medium", item.reminder ? "truncate" : "line-clamp-2")}>{item.title}</span>
              {!item.reminder && item.block.hours >= 1 ? (
                <span className="mt-[0.3cqw] block text-[1.15cqw] text-white/55">{item.block.time}</span>
              ) : null}
            </div>
          </Face>
        )}
      </AnimatePresence>
    </div>
  );
}

function Face({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {children}
    </motion.div>
  );
}

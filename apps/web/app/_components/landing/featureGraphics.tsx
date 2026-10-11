"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, FileText, Flame, Search, Table2, Timer } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "@/app/_components/site/motion";

/** Small looping graphics for the feature cards. Each one rests on its finished frame with reduced motion. */

const spring = { type: "spring", stiffness: 260, damping: 24 } as const;

/* ---- Auto-schedule: Work drops into free time, then moves when a meeting lands ---- */

const SCHEDULE_BLOCKS = [
  { id: "a", day: 0, start: 1, len: 2, color: "#c0c1ff", label: "Launch brief" },
  { id: "b", day: 1, start: 0, len: 1, color: "#4edea3", label: "Moving van" },
  { id: "c", day: 2, start: 2, len: 3, color: "#f0abfc", label: "Homepage" },
  { id: "d", day: 3, start: 4, len: 1, color: "#7cc4ff", label: "Spanish" },
  { id: "e", day: 4, start: 1, len: 2, color: "#ffb95f", label: "Invoices" },
];

export function ScheduleGraphic() {
  const { ref, frame } = useLoop(8, [700, 500, 500, 500, 500, 1400, 1800, 1600], 7);
  const shown = Math.min(frame + 1, 5);
  const meeting = frame >= 6;
  return (
    <div ref={ref} className="grid h-full grid-cols-5 gap-1.5" aria-hidden>
      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, dayIndex) => (
        <div key={day} className="relative overflow-hidden rounded-lg bg-white/[0.03]">
          <span className="absolute top-1.5 left-0 w-full text-center text-[10px] font-medium text-white/35">{day}</span>
          {dayIndex === 2 ? (
            <motion.div
              className="absolute inset-x-1 rounded-md border border-dashed border-white/25 bg-white/[0.06] px-1.5 py-1 text-[9px] text-white/60"
              style={{ top: `${18 + 2 * 12}%`, height: "22%" }}
              initial={false}
              animate={{ opacity: meeting ? 1 : 0, scale: meeting ? 1 : 0.9 }}
              transition={spring}
            >
              Meeting
            </motion.div>
          ) : null}
          {SCHEDULE_BLOCKS.map((block, index) => {
            if (block.day !== dayIndex) return null;
            const start = meeting && block.id === "c" ? 4.2 : block.start;
            return (
              <motion.div
                key={block.id}
                className="absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-1 text-[9px] leading-tight font-medium text-white/90 sm:text-[10px]"
                style={{
                  height: `${block.len * 11}%`,
                  background: `color-mix(in oklch, ${block.color} 28%, #15171e)`,
                  borderLeft: `3px solid ${block.color}`,
                }}
                initial={false}
                animate={{ top: `${18 + start * 12}%`, opacity: index < shown ? 1 : 0, y: index < shown ? 0 : -24 }}
                transition={spring}
              >
                {block.label}
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---- Search: type a few letters, results narrow ---- */

const QUERY = "launch";
const RESULTS = [
  { icon: Table2, title: "Launch budget", kind: "Sheet" },
  { icon: CheckCircle2, title: "Write the launch brief", kind: "Task" },
  { icon: FileText, title: "Website launch brief", kind: "Doc" },
  { icon: CheckCircle2, title: "Book the moving van", kind: "Task" },
];

export function SearchGraphic() {
  const { ref, frame } = useLoop(QUERY.length + 3, [700, 160, 160, 160, 160, 160, 900, 1800, 1200], QUERY.length + 1);
  const typed = QUERY.slice(0, Math.min(frame, QUERY.length));
  const filtered = typed.length >= 2 ? RESULTS.filter((r) => r.title.toLowerCase().includes(typed)) : RESULTS;
  const selected = frame >= QUERY.length + 1 ? 1 : 0;
  return (
    <div ref={ref} className="h-full rounded-xl border border-white/10 bg-[#15171e] p-2.5" aria-hidden>
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs">
        <Search className="size-3.5 text-white/40" />
        <span className="text-white/90">{typed}</span>
        <span className="s-blink -ml-1.5 h-3.5 w-px bg-white/70" />
        <span className="ml-auto rounded border border-white/10 px-1 font-mono text-[9px] text-white/40">⌘K</span>
      </div>
      <div className="mt-2 space-y-1">
        <AnimatePresence initial={false}>
          {filtered.map((result, index) => (
            <motion.div
              key={result.title}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors",
                index === selected ? "bg-[#c0c1ff]/15 text-white" : "text-white/60",
              )}
            >
              <result.icon className="size-3.5 shrink-0 text-white/45" />
              <span className="truncate">{result.title}</span>
              <span className="ml-auto text-[10px] text-white/35">{result.kind}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---- Dashboard: a pomodoro runs, counters settle ---- */

export function DashboardGraphic() {
  const { ref, frame } = useLoop(4, [1200, 1200, 1200, 1600], 3);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div ref={ref} className="grid h-full grid-cols-2 gap-2" aria-hidden>
      <div className="col-span-1 row-span-2 flex flex-col items-center justify-center rounded-xl border border-white/10 bg-[#15171e] p-2">
        <p className="flex items-center gap-1 text-[10px] font-medium text-white/50">
          <Timer className="size-3" />
          Pomodoro
        </p>
        <div className="relative mt-1.5">
          <svg viewBox="0 0 64 64" className="size-20 -rotate-90">
            <circle cx="32" cy="32" r={radius} fill="none" stroke="rgb(255 255 255 / 8%)" strokeWidth="5" />
            <motion.circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke="#c0c1ff"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={false}
              animate={{ strokeDashoffset: circumference * (1 - (frame + 1) / 5) }}
              transition={{ duration: 1, ease: "easeInOut" }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold text-white">
            {25 - (frame + 1) * 4}:00
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#15171e] p-2.5">
        <p className="text-[10px] text-white/45">Done this week</p>
        <motion.p key={frame} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-0.5 text-xl font-semibold text-white">
          {8 + frame}
        </motion.p>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#15171e] p-2.5">
        <p className="text-[10px] text-white/45">By priority</p>
        <div className="mt-1.5 space-y-1">
          {[0.9, 0.6, 0.35].map((width, index) => (
            <motion.div
              key={width}
              className="h-1.5 rounded-full"
              style={{ background: ["#ff8a80", "#ffb95f", "#7cc4ff"][index] }}
              initial={false}
              animate={{ width: `${Math.max(10, (width - frame * 0.08) * 100)}%` }}
              transition={spring}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Habits: a week of ticks and a growing streak ---- */

const HABITS = [
  { name: "Read 20 minutes", days: [1, 1, 1, 0, 1, 1, 1] },
  { name: "Spanish practice", days: [1, 1, 0, 1, 1, 0, 1] },
  { name: "Walk 8k steps", days: [0, 1, 1, 1, 1, 1, 1] },
];

export function HabitsGraphic() {
  const { ref, frame } = useLoop(8, [500, 260, 260, 260, 260, 260, 260, 2000], 7);
  return (
    <div ref={ref} className="space-y-2.5" aria-hidden>
      {HABITS.map((habit) => {
        const streak = habit.days.slice(0, frame).reduceRight(
          (acc, day) => (acc.stop ? acc : day ? { n: acc.n + 1, stop: false } : { n: acc.n, stop: true }),
          { n: 0, stop: false },
        ).n;
        return (
          <div key={habit.name} className="flex items-center gap-2">
            <span className="w-28 truncate text-[11px] text-white/70">{habit.name}</span>
            <span className="flex gap-1">
              {habit.days.map((day, index) => (
                <motion.span
                  key={index}
                  className="size-3.5 rounded-full border border-white/10"
                  initial={false}
                  animate={{
                    backgroundColor: index < frame && day ? "#4edea3" : "rgba(255,255,255,0.04)",
                    scale: index === frame - 1 && day ? [1.35, 1] : 1,
                  }}
                  transition={{ duration: 0.25 }}
                />
              ))}
            </span>
            <span className="ml-auto flex items-center gap-0.5 font-mono text-[11px] text-[#ffb95f]">
              <Flame className="size-3" />
              {streak}
            </span>
          </div>
        );
      })}
    </div>
  );
}

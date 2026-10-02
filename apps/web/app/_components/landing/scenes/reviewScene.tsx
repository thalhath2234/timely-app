"use client";

import { motion } from "motion/react";
import { CountUp, MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

// 0 empty · 1 completion · 2 priorities · 3 overdue and missed
const DELAYS = [450, 1100, 800] as const;

const DONE = 21;
const OPEN = 6;
const COMPLETION = Math.round((DONE * 100) / (DONE + OPEN));
const RING = 2 * Math.PI * 40;

// The app's fixed priority colours.
const PRIORITIES = [
  { label: "Urgent", open: 1, color: "#E5484D" },
  { label: "High", open: 2, color: "#F76808" },
  { label: "Medium", open: 2, color: "#FFB224" },
  { label: "Low", open: 1, color: "#889096" },
];
const MOST_OPEN = Math.max(...PRIORITIES.map((priority) => priority.open));

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function Flag({ show, tone, count, label, meaning }: { show: boolean; tone: string; count: number; label: string; meaning: string }) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 8 }}
      transition={sceneSpring}
      className="flex-1 rounded-lg border px-2.5 py-1.5"
      style={{
        borderColor: `color-mix(in oklch, ${tone} 25%, transparent)`,
        background: `color-mix(in oklch, ${tone} 12%, transparent)`,
      }}
    >
      <p className="mini-11 font-semibold" style={{ color: tone }}>
        <span className="font-mono">{count}</span> {label}
      </p>
      <p className="mini-9 text-muted-foreground">{meaning}</p>
    </motion.div>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow title="Report" className="h-full">
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-4">
            <div className="relative size-[calc(var(--u)*86)] shrink-0">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" strokeWidth="12" className="stroke-secondary" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  strokeWidth="12"
                  strokeLinecap="round"
                  className="stroke-success"
                  strokeDasharray={RING}
                  initial={false}
                  animate={{ strokeDashoffset: step >= 1 ? RING * (1 - COMPLETION / 100) : RING }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                />
              </svg>
              <span className="mini-18 absolute inset-0 flex items-center justify-center font-mono font-semibold">
                <CountUp value={COMPLETION} active={step >= 1} format={percent} />
              </span>
            </div>
            <div className="min-w-0">
              <p className="mini-9 font-semibold tracking-wider text-muted-foreground uppercase">Completion</p>
              <p className="mini-14 mt-0.5 font-semibold">
                <span className="font-mono">{DONE}</span> done · <span className="font-mono">{OPEN}</span> open
              </p>
              <p className="mini-10 mt-0.5 text-muted-foreground">Computed from your live tasks, not a stored report.</p>
            </div>
          </div>

          <div>
            <p className="mini-9 mb-1.5 font-semibold tracking-wider text-muted-foreground uppercase">Open by priority</p>
            <div className="flex flex-col gap-1.5">
              {PRIORITIES.map((priority, index) => (
                <div key={priority.label} className="flex items-center gap-2">
                  <span className="mini-10 w-[calc(var(--u)*44)] shrink-0 text-muted-foreground">{priority.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: priority.color }}
                      initial={false}
                      animate={{ width: step >= 2 ? `${(priority.open * 100) / MOST_OPEN}%` : "0%" }}
                      transition={{ ...sceneEase, duration: 0.7, delay: step >= 2 ? index * 0.1 : 0 }}
                    />
                  </div>
                  <span className="mini-10 w-3 shrink-0 text-right font-mono">{priority.open}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto flex gap-2">
            <Flag show={step >= 3} tone="var(--destructive)" count={1} label="Overdue" meaning="The deadline has passed." />
            <Flag show={step >= 3} tone="var(--warning)" count={1} label="Missed" meaning="Its block ended, still open." />
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function ReviewScene() {
  return (
    <SceneBox
      height={300}
      label="A report fills in: 78 percent completion, open work by priority, one overdue item and one missed block."
    >
      <Scene />
    </SceneBox>
  );
}

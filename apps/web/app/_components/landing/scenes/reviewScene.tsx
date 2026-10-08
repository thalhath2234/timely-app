"use client";

import { motion } from "motion/react";
import { priorityColor, type Priority } from "@/app/utils/priority";
import { WORK } from "../sampleData";
import { CountUp, MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

// 0 empty · 1 completion · 2 priorities · 3 overdue and due next
const DELAYS = [450, 1100, 800] as const;

const DONE = 21;
const OPEN = 6;
const COMPLETION = Math.round((DONE * 100) / (DONE + OPEN));
const RING = 2 * Math.PI * 40;

const OPEN_BY_PRIORITY: { label: Priority; open: number }[] = [
  { label: "Urgent", open: 1 },
  { label: "High", open: 2 },
  { label: "Medium", open: 2 },
  { label: "Low", open: 1 },
];
const MOST_OPEN = Math.max(...OPEN_BY_PRIORITY.map((priority) => priority.open));

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function Flag({ show, tone, label, detail }: { show: boolean; tone: string; label: string; detail: string }) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 8 }}
      transition={sceneSpring}
      className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5"
      style={{
        borderColor: `color-mix(in oklch, ${tone} 25%, transparent)`,
        background: `color-mix(in oklch, ${tone} 12%, transparent)`,
      }}
    >
      <p className="mini-11 font-semibold" style={{ color: tone }}>
        {label}
      </p>
      <p className="mini-9 truncate text-muted-foreground">{detail}</p>
    </motion.div>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow title="Dashboard" className="h-full">
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
              {OPEN_BY_PRIORITY.map((priority, index) => (
                <div key={priority.label} className="flex items-center gap-2">
                  <span className="mini-10 w-[calc(var(--u)*44)] shrink-0 text-muted-foreground">{priority.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: priorityColor(priority.label) ?? undefined }}
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
            <Flag show={step >= 3} tone="var(--destructive)" label="1 overdue" detail="Its deadline has passed." />
            <Flag show={step >= 3} tone="var(--primary)" label="Due next" detail={`${WORK.homepage.title} · Tue`} />
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
      label="A report fills in: 78 percent completion, open work by priority, one overdue item and what is due next."
    >
      <Scene />
    </SceneBox>
  );
}

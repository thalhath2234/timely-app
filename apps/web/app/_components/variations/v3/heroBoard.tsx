"use client";

import type { CSSProperties } from "react";
import { LayoutGroup, motion } from "motion/react";
import { Check, Clock } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";
import { ColumnHead } from "./column";

export const STAGES = [
  { id: "inbox", label: "Inbox", color: "var(--v3-inbox)" },
  { id: "clarified", label: "Clarified", color: "var(--v3-clarified)" },
  { id: "scheduled", label: "Scheduled", color: "var(--v3-scheduled)" },
  { id: "done", label: "Done", color: "var(--v3-done)" },
] as const;

type Task = {
  id: string;
  title: string;
  length: string;
  project: string;
  color: string;
  when: string;
  /** Which frame of the cycle the card first lands in the Inbox. */
  enter: number;
};

const TASKS: Task[] = [
  { id: "brief", title: "Launch brief", length: "2h", project: "Work", color: PALETTE.violet, when: "Thu 10:00", enter: 0 },
  { id: "landlord", title: "Call the landlord", length: "15m", project: "Home", color: PALETTE.green, when: "Tue 09:00", enter: 1 },
  { id: "numbers", title: "Quarterly numbers", length: "1h 30m", project: "Finance", color: PALETTE.amber, when: "Wed 14:00", enter: 3 },
  { id: "passport", title: "Renew passport", length: "30m", project: "Home", color: PALETTE.green, when: "Fri 11:30", enter: 4 },
  { id: "kickoff", title: "Kickoff doc for the website", length: "1h", project: "Website", color: PALETTE.blue, when: "Thu 13:00", enter: 6 },
  { id: "dentist", title: "Book the dentist", length: "10m", project: "Health", color: PALETTE.pink, when: "Mon 16:00", enter: 7 },
  { id: "flights", title: "Flights to Lisbon", length: "45m", project: "Trip", color: PALETTE.cyan, when: "Tue 15:00", enter: 9 },
  { id: "reviews", title: "Review pull requests", length: "1h", project: "Work", color: PALETTE.violet, when: "Wed 10:00", enter: 10 },
];

/* One lap of a card: 2 frames in the Inbox, 2 clarified, 3 scheduled, 3 done,
   then 2 frames off the board before it comes back in as a new card. */
const CYCLE = 12;
const DWELL = [2, 2, 3, 3] as const;
const FRAME_MS = 1500;

/** Under reduced motion the board rests with everything done but one card per column. */
const REST: number[] = [0, 1, 2, 3, 3, 3, 3, 3];

function stageAt(task: Task, t: number) {
  const offset = t - task.enter;
  const lap = Math.floor(offset / CYCLE);
  let s = ((offset % CYCLE) + CYCLE) % CYCLE;
  for (let stage = 0; stage < DWELL.length; stage += 1) {
    if (s < DWELL[stage]) return { stage, lap };
    s -= DWELL[stage];
  }
  return { stage: -1, lap };
}

/**
 * The hero: a live board where tasks move from the Inbox through Clarified
 * and Scheduled to Done. Cards gain chips as they go (length and project when
 * clarified, a day and time once scheduled) and are ticked and dimmed when done.
 */
export default function HeroBoard() {
  const { ref, frame, cycle, reduced } = useLoop(CYCLE, FRAME_MS, 0);
  const t = cycle * CYCLE + frame;

  const placed = TASKS.map((task, index) => {
    if (reduced) return { task, stage: REST[index], lap: 0 };
    return { task, ...stageAt(task, t) };
  });

  return (
    <div ref={ref} className="v3-board" role="img" aria-label="A board with four columns, Inbox, Clarified, Scheduled and Done, where task cards move from left to right.">
      <LayoutGroup>
        {STAGES.map((stage, stageIndex) => {
          const cards = placed.filter((entry) => entry.stage === stageIndex);
          return (
            <div key={stage.id} className="v3-board-col" aria-hidden>
              <ColumnHead color={stage.color} label={stage.label} count={cards.length} />
              <div className="v3-board-cards">
                {cards.map(({ task, lap }) => (
                  <TaskCard key={`${task.id}-${lap}`} id={`${task.id}-${lap}`} task={task} stage={stageIndex} />
                ))}
              </div>
            </div>
          );
        })}
      </LayoutGroup>
    </div>
  );
}

function TaskCard({ id, task, stage }: { id: string; task: Task; stage: number }) {
  const done = stage === 3;
  return (
    <motion.div
      layoutId={id}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: "spring", stiffness: 260, damping: 30 }, opacity: { duration: 0.35 }, y: { duration: 0.35 } }}
      className={cn("v3-card v3-task", done && "is-done")}
      style={{ "--c": task.color } as CSSProperties}
    >
      <div className="flex items-start gap-2">
        {done ? (
          <span className="mt-px flex size-4 flex-none items-center justify-center rounded-[3px] bg-[var(--v3-done)] text-[#1a1200]">
            <Check className="size-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="mt-[5px] size-2 flex-none rounded-full" style={{ background: task.color }} />
        )}
        <span className="v3-task-title">{task.title}</span>
      </div>
      {stage >= 1 ? (
        <div className="flex flex-wrap gap-1.5 pl-6">
          <span className="v3-chip">
            <Clock className="size-3" />
            {task.length}
          </span>
          <span className="v3-chip">{task.project}</span>
          {stage >= 2 ? <span className="v3-chip v3-chip-date">{task.when}</span> : null}
        </div>
      ) : null}
    </motion.div>
  );
}

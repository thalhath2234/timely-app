"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, Circle, Clock } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { PROJECT, REMINDER, REMINDER_COLOR, WORK } from "../sampleData";
import { MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

type Kind = "work" | "reminder";

/** The three thoughts from the Capture scene, in the order they were captured. */
const ITEMS: { title: string; kind: Kind; fields: [label: string, value: string][]; time: string }[] = [
  {
    title: WORK.brief.title,
    kind: "work",
    fields: [
      ["Duration", WORK.brief.duration],
      ["Workspace", `${PROJECT.workspace} · ${PROJECT.title}`],
    ],
    time: WORK.brief.duration,
  },
  {
    title: WORK.checklist.title,
    kind: "work",
    fields: [
      ["Duration", WORK.checklist.duration],
      ["Workspace", `${PROJECT.workspace} · ${PROJECT.title}`],
    ],
    time: WORK.checklist.duration,
  },
  { title: REMINDER.title, kind: "reminder", fields: [["Notify at", REMINDER.when]], time: REMINDER.when },
];

// Each item takes two steps: it appears, then its kind is chosen. The step
// after that files it below and brings up the next one.
const DELAYS = ITEMS.flatMap(() => [800, 1400]);

function KindToggle({ kind }: { kind: Kind | null }) {
  return (
    <div className="relative grid grid-cols-2 rounded-full bg-secondary p-0.5">
      {kind ? (
        <motion.i
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={sceneSpring}
          className={cn("absolute inset-y-0.5 w-[calc(50%-var(--u)*2)] rounded-full bg-primary", kind === "work" ? "left-0.5" : "right-0.5")}
        />
      ) : null}
      {(["work", "reminder"] as const).map((option) => (
        <span
          key={option}
          className={cn(
            "mini-10 relative px-3 py-1 text-center font-semibold transition-colors duration-300",
            kind === option ? "text-primary-foreground" : "text-muted-foreground",
          )}
        >
          {option === "work" ? "Work" : "Reminder"}
        </span>
      ))}
    </div>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const clarified = Math.min(Math.floor(step / 2), ITEMS.length);
  const current = ITEMS[clarified];
  const chosen = step % 2 === 1;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow
        title="Clarify"
        className="h-full"
        right={
          <span className="mini-9 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">
            Inbox <span className="font-mono">{ITEMS.length - clarified}</span>
          </span>
        }
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="h-[calc(var(--u)*132)] shrink-0">
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <motion.div
                  key={current.title}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                  transition={sceneEase}
                  className="flex h-full flex-col gap-2.5 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="mini-12 truncate font-semibold">{current.title}</span>
                  </div>
                  <KindToggle kind={chosen ? current.kind : null} />
                  {chosen ? (
                    <div className="flex flex-col gap-1.5">
                      {current.fields.map(([label, value]) => (
                        <motion.div
                          key={label}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={sceneEase}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="mini-10 text-muted-foreground">{label}</span>
                          <span className="mini-10 rounded-md border border-border bg-background px-2 py-0.5 font-medium">
                            {value}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  ) : null}
                </motion.div>
              ) : (
                <motion.div
                  key="clear"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={sceneEase}
                  className="mini-11 flex h-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input text-muted-foreground"
                >
                  <Check className="size-3.5 text-success" />
                  Inbox clear.
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mini-9 shrink-0 font-semibold tracking-wider text-muted-foreground uppercase">Now in Timely</p>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {ITEMS.slice(0, clarified).map((item) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: -16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={sceneSpring}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card py-1.5 pr-3 pl-2.5"
                  style={item.kind === "work" ? { borderLeft: `calc(var(--u) * 3) solid ${PROJECT.color}` } : undefined}
                >
                  {item.kind === "reminder" ? (
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `color-mix(in oklch, ${REMINDER_COLOR} 28%, var(--card))` }}
                    >
                      <Bell className="size-2.5" style={{ color: REMINDER_COLOR }} />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="mini-11 block truncate font-medium">{item.title}</span>
                    <span className="mini-9 text-muted-foreground">
                      {item.kind === "work" ? `Work · ${PROJECT.title}` : "Reminder · no busy time"}
                    </span>
                  </span>
                  <span className="mini-10 flex shrink-0 items-center gap-1 font-mono text-muted-foreground">
                    {item.kind === "work" ? <Clock className="size-2.5" /> : null}
                    {item.time}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {clarified === 0 ? <p className="mini-10 text-muted-foreground">Clarified items appear here.</p> : null}
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function ClarifyScene() {
  return (
    <SceneBox
      height={378}
      label="Three Inbox items are clarified in turn: two become Work with a duration and workspace, one becomes a Reminder with a time."
    >
      <Scene />
    </SceneBox>
  );
}

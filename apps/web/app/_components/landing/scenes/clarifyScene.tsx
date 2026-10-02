"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, Circle, Clock } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { PROJECT, REMINDER, REMINDER_COLOR, WORK } from "../sampleData";
import { MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

// 0 first item · 1 Work chosen · 2 Work created, second item · 3 Reminder chosen · 4 Reminder created
const DELAYS = [900, 1600, 1000, 1600] as const;

type Kind = "work" | "reminder";

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={sceneEase}
      className="flex items-center justify-between gap-3"
    >
      <span className="mini-10 text-muted-foreground">{label}</span>
      <span className="mini-10 rounded-md border border-border bg-background px-2 py-0.5 font-medium">{value}</span>
    </motion.div>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const second = step >= 2;
  const done = step >= 4;
  const title = second ? REMINDER.title : WORK.brief.title;
  const kind: Kind | null = step === 1 ? "work" : step >= 3 ? "reminder" : null;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow
        title="Clarify"
        className="h-full"
        right={
          <span className="mini-9 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">
            Inbox <span className="font-mono">{done ? 1 : second ? 2 : 3}</span>
          </span>
        }
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="h-[calc(var(--u)*138)] shrink-0">
            <AnimatePresence mode="wait" initial={false}>
              {done ? (
                <motion.div
                  key="clear"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={sceneEase}
                  className="mini-11 flex h-full items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground"
                >
                  One thought left to clarify.
                </motion.div>
              ) : (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={sceneEase}
                  className="flex h-full flex-col gap-2.5 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="mini-12 truncate font-semibold">{title}</span>
                  </div>
                  <KindToggle kind={kind} />
                  {kind === "work" ? (
                    <div className="flex flex-col gap-1.5">
                      <Field label="Duration" value={WORK.brief.duration} />
                      <Field label="Workspace" value={`${PROJECT.workspace} · ${PROJECT.title}`} />
                    </div>
                  ) : null}
                  {kind === "reminder" ? <Field label="Notify at" value={REMINDER.when} /> : null}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mini-9 shrink-0 font-semibold tracking-wider text-muted-foreground uppercase">Now in Timely</p>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {second ? (
                <motion.div
                  key="work"
                  initial={{ opacity: 0, y: -16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={sceneSpring}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card py-2 pr-3 pl-2.5"
                  style={{ borderLeft: `calc(var(--u) * 3) solid ${PROJECT.color}` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="mini-11 block truncate font-medium">{WORK.brief.title}</span>
                    <span className="mini-9 text-muted-foreground">Work · {PROJECT.title}</span>
                  </span>
                  <span className="mini-10 flex shrink-0 items-center gap-1 font-mono text-muted-foreground">
                    <Clock className="size-2.5" />
                    {WORK.brief.duration}
                  </span>
                </motion.div>
              ) : null}
              {done ? (
                <motion.div
                  key="reminder"
                  initial={{ opacity: 0, y: -16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={sceneSpring}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2"
                >
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `color-mix(in oklch, ${REMINDER_COLOR} 28%, var(--card))` }}
                  >
                    <Bell className="size-2.5" style={{ color: REMINDER_COLOR }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mini-11 block truncate font-medium">{REMINDER.title}</span>
                    <span className="mini-9 text-muted-foreground">Reminder · no busy time</span>
                  </span>
                  <span className="mini-10 shrink-0 font-mono text-muted-foreground">{REMINDER.when}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
            {!second ? (
              <p className="mini-10 flex items-center gap-1.5 text-muted-foreground">
                <Check className="size-3" /> Clarified items appear here.
              </p>
            ) : null}
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function ClarifyScene() {
  return (
    <SceneBox
      height={330}
      label="An Inbox item becomes Work with a duration and workspace; a second becomes a Reminder with a time."
    >
      <Scene />
    </SceneBox>
  );
}

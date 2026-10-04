"use client";

import { motion } from "motion/react";
import { Check, Circle, Play, Square } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { EVENT_COLOR, PROJECT, WORK } from "../sampleData";
import { CountUp, MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

// 0 ready · 1 focusing · 2 done
const DELAYS = [900, 2900] as const;
const FOCUSED_SECONDS = 84 * 60;

function clock(seconds: number) {
  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function Row({
  time,
  title,
  color,
  state,
}: {
  time: string;
  title: string;
  color: string;
  state: "done" | "open" | "next";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors duration-500",
        state === "next" ? "border-primary bg-accent" : "border-border bg-card",
      )}
    >
      {state === "done" ? (
        <motion.span
          initial={{ scale: 0.4 }}
          animate={{ scale: 1 }}
          transition={sceneSpring}
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-success"
        >
          <Check className="size-2.5 text-background" strokeWidth={3.5} />
        </motion.span>
      ) : (
        <Circle className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <i className="h-4 w-[calc(var(--u)*3)] shrink-0 rounded-full" style={{ background: color }} />
      <span
        className={cn(
          "mini-11 min-w-0 flex-1 truncate font-medium",
          state === "done" && "text-muted-foreground line-through",
        )}
      >
        {title}
      </span>
      {state === "next" ? <span className="mini-9 shrink-0 font-semibold text-primary">Up next</span> : null}
      <span className="mini-10 shrink-0 font-mono text-muted-foreground">{time}</span>
    </div>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const focusing = step === 1;
  const done = step >= 2;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow title="Today · Mon 5 Oct" className="h-full">
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "mini-9 flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold tracking-wider uppercase transition-colors duration-300",
                  done ? "bg-success/15 text-success" : focusing ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                )}
              >
                {focusing ? <i className="size-1.5 animate-pulse rounded-full bg-primary" /> : null}
                {done ? "Done" : focusing ? "Focusing" : "Ready"}
              </span>
              <span className="mini-10 ml-auto font-mono text-muted-foreground">est. {WORK.brief.duration}</span>
            </div>
            <p className="mini-14 mt-2 font-semibold">{WORK.brief.title}</p>
            <div className="mt-1.5 flex items-end gap-3">
              <span className="mini-26 leading-none font-mono font-medium">
                <CountUp value={FOCUSED_SECONDS} active={step >= 1} format={clock} duration={2.5} />
              </span>
              <span
                className={cn(
                  "mini-10 mb-0.5 ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold",
                  done ? "bg-secondary text-muted-foreground" : "bg-primary text-primary-foreground",
                )}
              >
                {done ? (
                  <>
                    <Check className="size-2.5" /> 6 min under
                  </>
                ) : focusing ? (
                  <>
                    <Square className="size-2.5" /> Stop
                  </>
                ) : (
                  <>
                    <Play className="size-2.5" /> Start focus
                  </>
                )}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className={cn("h-full rounded-full", done ? "bg-success" : "bg-primary")}
                initial={false}
                animate={{ width: step >= 1 ? "93%" : "0%" }}
                transition={step >= 1 ? { duration: 2.5, ease: "easeOut" } : sceneEase}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Row time="09:00" title="Weekly planning" color={EVENT_COLOR} state="done" />
            <Row time="10:00" title={WORK.brief.title} color={PROJECT.color} state={done ? "done" : "open"} />
            <Row time="11:30" title={WORK.checklist.title} color={PROJECT.color} state={done ? "next" : "open"} />
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function FocusScene() {
  return (
    <SceneBox
      height={300}
      label="A focus timer runs on one task from the Today list, then the task is ticked off and the next one is highlighted."
    >
      <Scene />
    </SceneBox>
  );
}

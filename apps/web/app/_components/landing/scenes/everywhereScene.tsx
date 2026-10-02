"use client";

import { motion } from "motion/react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { WORK } from "../sampleData";
import { Caret, MiniWindow, SceneBox, Typed, sceneSpring, typingTime, useScene } from "../scene";

const NEW_TASK = "Draft the announcement post";
const COMMAND = `create_task "${NEW_TASK}"`;

// 0 at rest · 1 ticked on the phone · 2 arrives on desktop · 3 agent types · 4 agent answers · 5 new task everywhere
const DELAYS = [900, 650, 1000, typingTime(COMMAND, 30), 800] as const;

function TaskLine({ title, done, round, tag }: { title: string; done: boolean; round?: boolean; tag?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-1">
      <span
        className={cn(
          "flex size-2.5 shrink-0 items-center justify-center border transition-colors duration-300",
          round ? "rounded-full" : "rounded-[calc(var(--u)*2)]",
          done ? "border-success bg-success" : "border-muted-foreground",
        )}
      >
        {done ? <Check className="size-2 text-background" strokeWidth={4} /> : null}
      </span>
      <span className={cn("mini-9 min-w-0 flex-1 truncate font-medium", done && "text-muted-foreground line-through")}>
        {title}
      </span>
      {tag ? <span className="mini-8 shrink-0 rounded-full bg-primary/15 px-1 font-semibold text-primary">{tag}</span> : null}
    </div>
  );
}

function Arrival({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: -8, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={sceneSpring}>
      {children}
    </motion.div>
  );
}

/** A dot that travels once between two points of the scene, given in percent. */
function Pulse({ from, to, delay = 0 }: { from: [number, number]; to: [number, number]; delay?: number }) {
  return (
    <motion.i
      className="absolute z-20 size-2 rounded-full bg-primary shadow-[0_0_0_calc(var(--u)*3)_color-mix(in_oklch,var(--primary)_30%,transparent)]"
      initial={{ left: `${from[0]}%`, top: `${from[1]}%`, opacity: 0 }}
      animate={{ left: `${to[0]}%`, top: `${to[1]}%`, opacity: [0, 1, 1, 0] }}
      transition={{ duration: 0.6, delay, ease: "easeInOut" }}
    />
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow title="Timely · desktop" className="absolute top-0 left-0 h-[46%] w-[62%]">
        <div className="flex flex-col gap-1 p-2">
          <TaskLine title={WORK.checklist.title} done={step >= 2} />
          <TaskLine title={WORK.homepage.title} done={false} />
          {step >= 5 ? (
            <Arrival>
              <TaskLine title={NEW_TASK} done={false} tag="agent" />
            </Arrival>
          ) : null}
        </div>
      </MiniWindow>

      <div className="mini-window absolute top-[4%] right-0 flex h-[84%] w-[32%] flex-col rounded-[calc(var(--u)*20)]!">
        <i className="mx-auto mt-1.5 h-1 w-8 shrink-0 rounded-full bg-secondary" />
        <p className="mini-12 px-2.5 pt-2 font-bold">Today</p>
        <div className="flex flex-1 flex-col gap-1 p-2">
          <TaskLine title={WORK.checklist.title} done={step >= 1} round />
          <TaskLine title={WORK.homepage.title} done={false} round />
          {step >= 5 ? (
            <Arrival>
              <TaskLine title={NEW_TASK} done={false} round tag="agent" />
            </Arrival>
          ) : null}
        </div>
        <span className="mr-2 mb-2 ml-auto flex size-6 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Plus className="size-3" />
        </span>
      </div>

      <div
        className="mini-window absolute bottom-0 left-[5%] flex h-[38%] w-[59%] flex-col font-mono"
        style={{ background: "#0c0e14", color: "#e2e2eb", borderColor: "rgb(255 255 255 / 12%)" }}
      >
        <p className="mini-9 border-b border-white/10 px-2.5 py-1.5 text-[#908fa0]">MCP agent · 147 tools</p>
        <div className="mini-9 flex flex-col gap-1 p-2.5 leading-snug">
          <p>
            <span className="text-[#c0c1ff]">›</span>{" "}
            {step >= 3 ? <Typed text={COMMAND} state={step === 3 ? "typing" : "done"} speed={30} /> : null}
            {step <= 3 ? <Caret /> : null}
          </p>
          {step >= 4 ? (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[#4edea3]">
              ✓ created · 1h · Website refresh
            </motion.p>
          ) : null}
        </div>
      </div>

      {step === 2 ? <Pulse from={[68, 30]} to={[56, 20]} /> : null}
      {step === 4 ? (
        <>
          <Pulse from={[36, 60]} to={[30, 42]} delay={0.15} />
          <Pulse from={[62, 68]} to={[76, 52]} delay={0.15} />
        </>
      ) : null}
    </div>
  );
}

export default function EverywhereScene() {
  return (
    <SceneBox
      height={320}
      label="A task ticked on the phone is ticked on the desktop; a task created by an MCP agent appears on both."
    >
      <Scene />
    </SceneBox>
  );
}

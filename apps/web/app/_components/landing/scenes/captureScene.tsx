"use client";

import { AnimatePresence, motion } from "motion/react";
import { Circle, CornerDownLeft, Plus } from "lucide-react";
import { REMINDER, WORK } from "../sampleData";
import { Caret, MiniWindow, SceneBox, Typed, sceneSpring, typingTime, useScene } from "../scene";

const THOUGHTS = [WORK.brief.title, WORK.checklist.title, REMINDER.title];

// Odd steps type a thought; the even step after each one files it.
const DELAYS = [600, ...THOUGHTS.flatMap((thought) => [typingTime(thought), 450])].slice(0, -1);

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const typingIndex = step % 2 === 1 ? (step - 1) / 2 : -1;
  const captured = THOUGHTS.slice(0, Math.floor(step / 2));

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow
        title="Inbox"
        className="h-full"
        right={
          <span className="mini-9 rounded-full bg-secondary px-2 py-0.5 font-mono font-medium text-muted-foreground">
            {captured.length}
          </span>
        }
      >
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2.5">
            <Plus className="size-3.5 shrink-0 text-primary" />
            <span className="mini-12 min-w-0 flex-1 truncate">
              {typingIndex >= 0 ? (
                <>
                  <Typed text={THOUGHTS[typingIndex]} state="typing" />
                  <Caret />
                </>
              ) : (
                <span className="text-muted-foreground">Capture a thought…</span>
              )}
            </span>
            <kbd className="mini-9 flex items-center rounded border border-border px-1 py-0.5 text-muted-foreground">
              <CornerDownLeft className="size-2.5" />
            </kbd>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {[...captured].reverse().map((title) => (
                <motion.div
                  key={title}
                  layout
                  initial={{ opacity: 0, y: -14, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={sceneSpring}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="mini-12 min-w-0 flex-1 truncate font-medium">{title}</span>
                  <span className="mini-9 shrink-0 font-mono text-muted-foreground">just now</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {captured.length === 0 ? (
              <p className="mini-11 m-auto text-muted-foreground">Nothing captured yet.</p>
            ) : null}
          </div>

          <p className="mini-10 shrink-0 text-muted-foreground">
            No date, no project, no estimate. Those come when you clarify.
          </p>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function CaptureScene() {
  return (
    <SceneBox height={300} label="Three thoughts are typed one line at a time and stack up in the Inbox.">
      <Scene />
    </SceneBox>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { MiniWeek, slotColors, slotRect } from "../miniWeek";
import { EVENT_COLOR, EVENT_SLOTS, PROJECT, WORK, WORK_SLOTS } from "../sampleData";
import { MiniWindow, SceneBox, SceneButton, sceneEase, sceneSpring, useScene } from "../scene";

// Step 1 is the resting state; the visitor drives the rest.
const DELAYS = [500] as const;
const PREVIEW = 2;
const APPLIED = 3;

const WAITING = Object.values(WORK);

function Scene() {
  const { ref, step, setStep } = useScene(DELAYS);
  const preview = step === PREVIEW;
  const applied = step === APPLIED;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow
        title="Calendar"
        className="h-full"
        right={
          <SceneButton primary disabled={step !== 1} pulse={step === 1} onClick={() => setStep(PREVIEW)}>
            <Sparkles className="size-2.5" />
            Auto-schedule
          </SceneButton>
        }
      >
        <div className="flex h-full">
          <div className="flex w-[27%] shrink-0 flex-col gap-1 border-r border-border bg-card p-1.5">
            <p className="mini-8 px-0.5 font-semibold tracking-wider text-muted-foreground uppercase">
              Waiting <span className="font-mono">{applied ? 0 : WAITING.length}</span>
            </p>
            <AnimatePresence initial={false}>
              {applied ? (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...sceneEase, delay: 0.3 }}
                  className="mini-9 m-auto flex flex-col items-center gap-1 text-center text-muted-foreground"
                >
                  <Check className="size-3.5 text-success" />
                  Nothing waiting
                </motion.p>
              ) : (
                WAITING.map((work, index) => (
                  <motion.div
                    key={work.title}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: step === 0 ? 0 : preview ? 0.45 : 1, x: step === 0 ? -12 : 0 }}
                    exit={{ opacity: 0, x: 24, transition: { duration: 0.2, delay: index * 0.05 } }}
                    transition={{ ...sceneSpring, delay: index * 0.06 }}
                    className="rounded-md border border-border bg-background py-1 pr-1 pl-1.5"
                    style={{ borderLeft: `calc(var(--u) * 3) solid ${PROJECT.color}` }}
                  >
                    <span className="mini-9 line-clamp-2 leading-tight font-medium">{work.title}</span>
                    <span className="mini-8 font-mono text-muted-foreground">{work.duration}</span>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <MiniWeek className="min-h-0 flex-1">
              {EVENT_SLOTS.map((slot) => (
                <div key={slot.id} className="absolute p-px" style={slotRect(slot)}>
                  <div
                    className="mini-8 h-full overflow-hidden rounded-sm px-0.5 py-px leading-tight font-medium"
                    style={slotColors(EVENT_COLOR)}
                  >
                    <span className="line-clamp-2">{slot.title}</span>
                  </div>
                </div>
              ))}
              <AnimatePresence>
                {preview || applied
                  ? WORK_SLOTS.map((slot, index) => (
                      <motion.div
                        key={slot.id}
                        className="absolute p-px"
                        style={slotRect(slot)}
                        initial={{ opacity: 0, x: "-70%", scale: 0.85 }}
                        animate={{ opacity: applied ? 1 : 0.62, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: "-70%", scale: 0.85, transition: { duration: 0.25, delay: index * 0.03 } }}
                        transition={{ ...sceneSpring, delay: applied ? 0 : index * 0.08 }}
                      >
                        <div
                          className={cn(
                            "mini-8 h-full overflow-hidden rounded-sm px-0.5 py-px leading-tight font-medium",
                            !applied && "outline-1 -outline-offset-1 outline-primary outline-dashed",
                          )}
                          style={slotColors(PROJECT.color)}
                        >
                          <span className="line-clamp-2">{slot.title}</span>
                          {slot.part ? <span className="font-mono text-muted-foreground">{slot.part}</span> : null}
                        </div>
                      </motion.div>
                    ))
                  : null}
              </AnimatePresence>
            </MiniWeek>

            <div className="flex h-10 shrink-0 items-center border-t border-border bg-card px-2.5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={applied ? "applied" : preview ? "preview" : "idle"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={sceneEase}
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                >
                  {applied ? (
                    <>
                      <Check className="size-3 shrink-0 text-success" />
                      <span className="mini-10 min-w-0 flex-1 truncate font-medium">Schedule applied</span>
                      <SceneButton onClick={() => setStep(1)}>
                        <Undo2 className="size-2.5" />
                        Undo
                      </SceneButton>
                    </>
                  ) : preview ? (
                    <>
                      <span className="mini-10 min-w-0 flex-1 leading-tight">
                        <span className="font-semibold">Preview:</span> 6 blocks, nothing skipped
                      </span>
                      <SceneButton onClick={() => setStep(1)}>Cancel</SceneButton>
                      <SceneButton primary pulse onClick={() => setStep(APPLIED)}>
                        Apply
                      </SceneButton>
                    </>
                  ) : (
                    <span className="mini-10 truncate text-muted-foreground">
                      Events are fixed. Work is waiting for a time.
                    </span>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </MiniWindow>
    </div>
  );
}

export default function AutoScheduleScene() {
  return (
    <SceneBox
      height={372}
      interactive
      label="Interactive demo: press Auto-schedule to preview where waiting Work would go on the week, then apply or undo it."
    >
      <Scene />
    </SceneBox>
  );
}

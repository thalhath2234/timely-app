"use client";

import { motion } from "motion/react";
import { Bell } from "lucide-react";
import { MiniWeek, slotColors, slotRect } from "../miniWeek";
import { EVENT_COLOR, EVENT_SLOTS, PROJECT, REMINDER, REMINDER_COLOR, WORK_SLOTS } from "../sampleData";
import { MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

const DELAYS = [1100, 1500] as const;

/** Where each thought sits before it is placed, as a loose sticky note over the grid. */
const NOTES: Record<string, { text: string; left: string; top: string; rotate: number; paper: string }> = {
  brief: { text: "launch brief?", left: "3%", top: "56%", rotate: -8, paper: "#ffe08a" },
  checklist: { text: "checklist!!", left: "37%", top: "24%", rotate: 6, paper: "#ffc2d4" },
  "homepage-1": { text: "homepage design", left: "58%", top: "58%", rotate: -5, paper: "#c5ddff" },
  "homepage-2": { text: "homepage design", left: "58%", top: "58%", rotate: -5, paper: "#c5ddff" },
  budget: { text: "budget", left: "66%", top: "8%", rotate: 9, paper: "#bdebd0" },
  form: { text: "test the form", left: "24%", top: "76%", rotate: -11, paper: "#ddd0ff" },
};

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const placed = step >= 1;
  const settled = step >= 2;

  return (
    <div ref={ref} className="absolute inset-0">
      <MiniWindow
        title="Calendar · Week of 5 Oct"
        className="h-full"
        right={
          <span className="mini-9 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">
            {placed ? "6 blocks placed" : "5 loose thoughts"}
          </span>
        }
      >
        <MiniWeek>
          {EVENT_SLOTS.map((slot) => (
            <div key={slot.id} className="absolute p-px" style={slotRect(slot)}>
              <div className="mini-9 h-full overflow-hidden rounded-sm px-1 py-0.5 font-medium" style={slotColors(EVENT_COLOR)}>
                <span className="line-clamp-2">{slot.title}</span>
              </div>
            </div>
          ))}

          {WORK_SLOTS.map((slot, index) => {
            const note = NOTES[slot.id];
            const rect = slotRect(slot);
            const secondChunk = slot.id === "homepage-2";
            return (
              <motion.div
                key={slot.id}
                className="absolute p-px"
                initial={false}
                animate={
                  placed
                    ? { ...rect, rotate: 0, opacity: 1 }
                    : { left: note.left, top: note.top, width: "31%", height: "15%", rotate: note.rotate, opacity: secondChunk ? 0 : 1 }
                }
                transition={{ ...sceneSpring, delay: placed ? index * 0.09 : 0 }}
              >
                <div className="relative h-full overflow-hidden rounded-sm">
                  <motion.div
                    className="mini-10 absolute inset-0 flex items-center justify-center px-1 text-center font-semibold text-[#3a2f1a]"
                    style={{ background: note.paper }}
                    initial={false}
                    animate={{ opacity: placed ? 0 : 1 }}
                    transition={sceneEase}
                  >
                    {note.text}
                  </motion.div>
                  <motion.div
                    className="mini-9 absolute inset-0 px-1 py-0.5 font-medium"
                    style={slotColors(PROJECT.color)}
                    initial={false}
                    animate={{ opacity: placed ? 1 : 0 }}
                    transition={{ ...sceneEase, delay: placed ? index * 0.09 + 0.1 : 0 }}
                  >
                    <span className={slot.hours < 1.5 ? "line-clamp-1" : "line-clamp-2"}>{slot.title}</span>
                    {slot.part && slot.hours >= 1.5 ? (
                      <span className="mini-8 font-mono text-muted-foreground">{slot.part}</span>
                    ) : null}
                  </motion.div>
                </div>
              </motion.div>
            );
          })}

          <motion.div
            className="absolute p-px"
            style={{ ...slotRect({ day: 4, start: 9, hours: 0.6 }) }}
            initial={false}
            animate={{ opacity: settled ? 1 : 0, scale: settled ? 1 : 0.7 }}
            transition={sceneSpring}
          >
            <div
              className="mini-8 flex h-full items-center gap-0.5 overflow-hidden rounded-full px-1 font-medium"
              style={{ background: `color-mix(in oklch, ${REMINDER_COLOR} 30%, var(--card))` }}
            >
              <Bell className="size-2 shrink-0" style={{ color: REMINDER_COLOR }} />
              <span className="truncate">{REMINDER.title}</span>
            </div>
          </motion.div>

          <motion.div
            className="absolute flex items-center"
            style={{ left: 0, width: "20%", top: `${((12.6 - 9) * 100) / 8}%` }}
            initial={false}
            animate={{ opacity: settled ? 1 : 0, scaleX: settled ? 1 : 0 }}
            transition={sceneEase}
          >
            <i className="size-1.5 shrink-0 rounded-full bg-primary" />
            <i className="h-px flex-1 bg-primary" />
          </motion.div>
        </MiniWeek>
      </MiniWindow>
    </div>
  );
}

export default function HeroScene() {
  return (
    <SceneBox height={330} eager label="Loose sticky-note thoughts settle into blocks on a weekly calendar, around existing events.">
      <Scene />
    </SceneBox>
  );
}

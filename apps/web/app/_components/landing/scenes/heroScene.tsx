"use client";

import { motion } from "motion/react";
import { Bell } from "lucide-react";
import { EventBlocks, MiniWeek, blockColors, blockRect, hourTop } from "../miniWeek";
import { PROJECT, REMINDER, REMINDER_COLOR, WEEK_DAYS, WORK, WORK_BLOCKS, type WorkId } from "../sampleData";
import { MiniWindow, SceneBox, sceneEase, sceneSpring, useScene } from "../scene";

const DELAYS = [1100, 1500] as const;

/** Where each piece of Work sits before it is placed, as a loose sticky note over the grid. */
const NOTES: Record<WorkId, { text: string; left: string; top: string; rotate: number; paper: string }> = {
  brief: { text: "launch brief?", left: "3%", top: "56%", rotate: -8, paper: "#ffe08a" },
  checklist: { text: "checklist!!", left: "37%", top: "24%", rotate: 6, paper: "#ffc2d4" },
  homepage: { text: "homepage design", left: "58%", top: "58%", rotate: -5, paper: "#c5ddff" },
  budget: { text: "budget", left: "66%", top: "8%", rotate: 9, paper: "#bdebd0" },
  form: { text: "test the form", left: "24%", top: "76%", rotate: -11, paper: "#ddd0ff" },
};

const THOUGHTS = Object.keys(WORK).length;
const NOW = 12.6;

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
            {placed ? `${WORK_BLOCKS.length} blocks placed` : `${THOUGHTS} loose thoughts`}
          </span>
        }
      >
        <MiniWeek>
          <EventBlocks />

          {WORK_BLOCKS.map((block, index) => {
            const note = NOTES[block.work];
            // A later chunk of split Work has no note of its own; it appears out of the first one's.
            const laterChunk = WORK_BLOCKS.findIndex((other) => other.work === block.work) !== index;
            return (
              <motion.div
                key={`${block.work}-${block.part ?? ""}`}
                className="absolute p-px"
                initial={false}
                animate={
                  placed
                    ? { ...blockRect(block), rotate: 0, opacity: 1 }
                    : { left: note.left, top: note.top, width: "31%", height: "15%", rotate: note.rotate, opacity: laterChunk ? 0 : 1 }
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
                    style={blockColors(PROJECT.color)}
                    initial={false}
                    animate={{ opacity: placed ? 1 : 0 }}
                    transition={{ ...sceneEase, delay: placed ? index * 0.09 + 0.1 : 0 }}
                  >
                    <span className={block.hours < 1.5 ? "line-clamp-1" : "line-clamp-2"}>{block.title}</span>
                    {block.part && block.hours >= 1.5 ? (
                      <span className="mini-8 font-mono text-muted-foreground">{block.part}</span>
                    ) : null}
                  </motion.div>
                </div>
              </motion.div>
            );
          })}

          <motion.div
            className="absolute p-px"
            style={blockRect({ day: WEEK_DAYS.length - 1, start: 9, hours: 0.6 })}
            initial={false}
            animate={{ opacity: settled ? 1 : 0, scale: settled ? 1 : 0.7 }}
            transition={sceneSpring}
          >
            <div
              className="mini-8 flex h-full items-center gap-0.5 overflow-hidden rounded-full px-1 font-medium"
              style={{ background: `color-mix(in oklab, ${REMINDER_COLOR} 30%, var(--card))` }}
            >
              <Bell className="size-2 shrink-0" style={{ color: REMINDER_COLOR }} />
              <span className="truncate">{REMINDER.title}</span>
            </div>
          </motion.div>

          <motion.div
            className="absolute flex items-center"
            style={{ left: 0, width: `${100 / WEEK_DAYS.length}%`, top: hourTop(NOW) }}
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

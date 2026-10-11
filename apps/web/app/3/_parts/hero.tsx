"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useInView } from "motion/react";
import { CalendarClock, Check, CornerDownLeft, Crosshair, Timer } from "lucide-react";
import { useModKey } from "./platformKey";
import { useReduced } from "./motion";

/* ---- The week the commands land on: Mon 12 – Fri 16 Oct, 09:00–18:00 ---- */

const DAYS = [
  { name: "Mon", date: 12 },
  { name: "Tue", date: 13 },
  { name: "Wed", date: 14 },
  { name: "Thu", date: 15 },
  { name: "Fri", date: 16 },
];
const FIRST = 9;
const HOURS = 9;
const NOW = 10 + 5 / 60;
const WORK_END = 17.5;

const EVENTS = [
  { day: 0, from: 9.5, to: 10, title: "Standup" },
  { day: 2, from: 9.5, to: 10, title: "Standup" },
  { day: 4, from: 9.5, to: 10, title: "Standup" },
  { day: 0, from: 14, to: 15, title: "Hiring sync" },
  { day: 1, from: 13, to: 14, title: "1:1 with Sam" },
  { day: 2, from: 11, to: 12.5, title: "Design review" },
  { day: 3, from: 15, to: 16, title: "Investor call" },
  { day: 4, from: 16, to: 17, title: "Team demo" },
];

type Block = { id: string; day: number; from: number; to: number; title: string; length: string };

function clock(value: number) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function slot(block: Pick<Block, "day" | "from" | "to">) {
  return `${DAYS[block.day].name} ${clock(block.from)}–${clock(block.to)}`;
}

type Scene = {
  command: string;
  heading: string;
  action: string;
  rows: (Block & { note?: string })[];
  /** Extra non-moving rows shown under the ones that get placed. */
  options?: string[];
  done: string;
  focus?: string;
};

const SCENES: Scene[] = [
  {
    command: "plan my week",
    heading: "Auto-schedule · 5 to place · Mon 12 – Fri 16 Oct",
    action: "Apply schedule",
    rows: [
      { id: "budget", day: 0, from: 10.5, to: 11.5, title: "Review Q3 budget", length: "1h" },
      { id: "investor", day: 1, from: 10, to: 11.5, title: "Draft investor update", length: "1h 30m" },
      { id: "copy", day: 2, from: 14, to: 14.75, title: "Fix onboarding copy", length: "45m" },
      { id: "flights", day: 0, from: 16, to: 16.5, title: "Book flights for December", length: "30m" },
      { id: "deck", day: 4, from: 10, to: 10.5, title: "Send deck to Sam", length: "30m" },
    ],
    done: "5 blocks placed around 8 events, inside 09:00–17:30",
  },
  {
    command: "/schedule launch brief",
    heading: "Launch brief · 2h · one unbroken block",
    action: "Schedule",
    rows: [{ id: "brief", day: 3, from: 10, to: 12, title: "Launch brief", length: "2h", note: "first free slot" }],
    options: ["Thu 13:00–15:00", "Fri 13:00–15:00"],
    done: "Launch brief placed Thu 10:00–12:00, before the investor call",
  },
  {
    command: "focus review q3 budget",
    heading: "Review Q3 budget · Mon 10:30–11:30",
    action: "Start Focus",
    rows: [],
    options: ["Start Focus", "Open task", "Mark done"],
    done: "Focus started · minutes go to Review Q3 budget",
    focus: "budget",
  },
];

/* ---- Timeline: every keystroke and placement is one step ---- */

type Phase = "open" | "type" | "results" | "enter" | "place" | "rest";
type Step = { scene: number; phase: Phase; chars: number; placed: number; ms: number };

const TIMELINE: Step[] = SCENES.flatMap((scene, sceneIndex) => {
  const steps: Step[] = [{ scene: sceneIndex, phase: "open", chars: 0, placed: 0, ms: 700 }];
  for (let chars = 1; chars <= scene.command.length; chars += 1) {
    steps.push({ scene: sceneIndex, phase: "type", chars, placed: 0, ms: scene.command[chars] === " " ? 110 : 62 });
  }
  steps.push({ scene: sceneIndex, phase: "results", chars: scene.command.length, placed: 0, ms: sceneIndex === 0 ? 2300 : 1700 });
  steps.push({ scene: sceneIndex, phase: "enter", chars: scene.command.length, placed: 0, ms: 380 });
  for (let placed = 1; placed <= scene.rows.length; placed += 1) {
    steps.push({ scene: sceneIndex, phase: "place", chars: scene.command.length, placed, ms: 260 });
  }
  steps.push({ scene: sceneIndex, phase: "rest", chars: 0, placed: scene.rows.length, ms: sceneIndex === SCENES.length - 1 ? 5200 : 1900 });
  return steps;
});

/** First frame: the opening command typed and its results listed, so the hero reads before anything moves. */
const START = TIMELINE.findIndex((step) => step.phase === "results");
const REST = TIMELINE.length - 1;

function blocksFor(step: Step) {
  const placed: Block[] = [];
  SCENES.forEach((scene, index) => {
    if (index < step.scene) placed.push(...scene.rows);
    else if (index === step.scene) placed.push(...scene.rows.slice(0, step.placed));
  });
  return placed;
}

function FocusTimer({ running }: { running: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const shown = running ? seconds : 12 * 60 + 40;
  return (
    <span className="d3-focus-time">
      {String(Math.floor(shown / 60)).padStart(2, "0")}:{String(shown % 60).padStart(2, "0")}
    </span>
  );
}

export default function HeroStage() {
  const mod = useModKey();
  const reduced = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const [index, setIndex] = useState(START);
  const [cycle, setCycle] = useState(0);
  const at = reduced ? REST : index;
  const step = TIMELINE[at];
  const scene = SCENES[step.scene];

  useEffect(() => {
    if (!inView || reduced) return;
    const timer = window.setTimeout(() => {
      if (index + 1 >= TIMELINE.length) {
        setCycle((count) => count + 1);
        setIndex(0);
      } else {
        setIndex(index + 1);
      }
    }, TIMELINE[index].ms);
    return () => window.clearTimeout(timer);
  }, [index, inView, reduced]);

  const blocks = blocksFor(step);
  const typing = step.phase === "open" || step.phase === "type";
  const listOpen = step.phase === "results" || step.phase === "enter" || step.phase === "place";
  const shownRows = scene.rows.slice(step.phase === "place" ? step.placed : 0);
  const input = step.phase === "rest" ? "" : scene.command.slice(0, step.phase === "open" ? 0 : step.chars);
  const focusing = step.scene === 2 && step.phase === "rest" ? scene.focus : undefined;

  return (
    <div ref={ref} className="d3-stage">
      <p className="d3-sr">
        Illustration: a command palette. Typing &ldquo;plan my week&rdquo; lists five tasks with free slots; pressing
        Enter places them on the week around meetings and inside working hours. &ldquo;/schedule launch brief&rdquo;
        finds a two-hour slot on Thursday, and &ldquo;focus review q3 budget&rdquo; starts a focus timer.
      </p>
      <LayoutGroup id={`hero-${cycle}`}>
        <div className="d3-stage-inner" aria-hidden>
          {/* The palette */}
          <div className="d3-cmd" data-open={listOpen || undefined}>
            <div className="d3-cmd-bar">
              <span className="d3-cmd-prompt">›</span>
              <span className="d3-cmd-text">
                {input ? input : typing ? "" : <span className="d3-cmd-placeholder">Type a command</span>}
                <span className="d3-caret" data-solid={typing || undefined} />
              </span>
              <span className="d3-keys">
                <kbd className="d3-key" data-size="sm" data-pressed={step.phase === "open" || undefined}>
                  {mod}
                </kbd>
                <kbd className="d3-key" data-size="sm" data-pressed={step.phase === "open" || undefined}>
                  K
                </kbd>
              </span>
            </div>

            <AnimatePresence>
              {step.phase === "rest" ? (
                <motion.p
                  key={`done-${step.scene}`}
                  className="d3-cmd-done"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Check className="d3-ico-sm" strokeWidth={2.5} />
                  {scene.done}
                </motion.p>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {listOpen ? (
                <motion.div
                  key={`list-${step.scene}`}
                  className="d3-cmd-list"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.2 }}
                >
                  <p className="d3-cmd-head">{scene.heading}</p>
                  <ul>
                    {shownRows.map((row, rowIndex) => (
                      <motion.li
                        key={row.id}
                        layoutId={`blk-${row.id}`}
                        className="d3-cmd-row"
                        data-active={rowIndex === 0 || undefined}
                        transition={{ type: "spring", stiffness: 300, damping: 32 }}
                      >
                        <span className="d3-cmd-ico">
                          <CalendarClock className="d3-ico-sm" />
                        </span>
                        <span className="d3-cmd-title">{row.title}</span>
                        <span className="d3-cmd-meta">{row.note ?? row.length}</span>
                        <span className="d3-cmd-slot">{slot(row)}</span>
                      </motion.li>
                    ))}
                    {scene.options?.map((option, optionIndex) => (
                      <li
                        key={option}
                        className="d3-cmd-row d3-cmd-option"
                        data-active={(!scene.rows.length && optionIndex === 0) || undefined}
                      >
                        <span className="d3-cmd-ico">
                          {scene.focus ? (
                            optionIndex === 0 ? (
                              <Timer className="d3-ico-sm" />
                            ) : (
                              <Crosshair className="d3-ico-sm" />
                            )
                          ) : (
                            <CalendarClock className="d3-ico-sm" />
                          )}
                        </span>
                        <span className="d3-cmd-title">{option}</span>
                        {scene.focus && optionIndex === 0 ? <span className="d3-cmd-slot">Mon 10:30</span> : null}
                      </li>
                    ))}
                  </ul>
                  <p className="d3-cmd-foot">
                    <span>
                      <kbd className="d3-key" data-size="sm" data-pressed={step.phase === "enter" || undefined}>
                        ↵
                      </kbd>
                      {scene.action}
                    </span>
                    <span>
                      <kbd className="d3-key" data-size="sm">
                        Esc
                      </kbd>
                      Discard
                    </span>
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* The week */}
          <div className="d3-week">
            <div className="d3-week-head">
              <span className="d3-week-label">Oct</span>
              {DAYS.map((day, dayIndex) => (
                <span key={day.name} className="d3-week-day" data-today={dayIndex === 0 || undefined}>
                  {day.name} <b>{day.date}</b>
                </span>
              ))}
            </div>
            <div className="d3-week-body">
              <div className="d3-week-hours">
                {Array.from({ length: HOURS }, (_, hour) => (
                  <span key={hour} style={{ top: `${(hour / HOURS) * 100}%` }}>
                    {String(FIRST + hour).padStart(2, "0")}
                  </span>
                ))}
              </div>
              {DAYS.map((day, dayIndex) => (
                <div key={day.name} className="d3-week-col">
                  <div
                    className="d3-week-off"
                    style={{ top: `${((WORK_END - FIRST) / HOURS) * 100}%` }}
                  />
                  {EVENTS.filter((event) => event.day === dayIndex).map((event) => (
                    <div
                      key={`${event.title}-${event.from}`}
                      className="d3-event"
                      data-past={(dayIndex === 0 && event.to <= NOW) || undefined}
                      style={{
                        top: `${((event.from - FIRST) / HOURS) * 100}%`,
                        height: `${((event.to - event.from) / HOURS) * 100}%`,
                      }}
                    >
                      <span>{event.title}</span>
                    </div>
                  ))}
                  {blocks
                    .filter((block) => block.day === dayIndex)
                    .map((block) => (
                      <motion.div
                        key={block.id}
                        layoutId={`blk-${block.id}`}
                        className="d3-block"
                        data-short={block.to - block.from < 0.9 || undefined}
                        data-focus={focusing === block.id || undefined}
                        transition={{ type: "spring", stiffness: 300, damping: 32 }}
                        style={{
                          top: `${((block.from - FIRST) / HOURS) * 100}%`,
                          height: `${((block.to - block.from) / HOURS) * 100}%`,
                        }}
                      >
                        <span className="d3-block-title">{block.title}</span>
                        {focusing === block.id ? (
                          <span className="d3-block-time">
                            <span className="d3-rec" /> Focus <FocusTimer running={!reduced} />
                          </span>
                        ) : (
                          <span className="d3-block-time">{clock(block.from)}</span>
                        )}
                      </motion.div>
                    ))}
                  {dayIndex === 0 ? (
                    <div className="d3-now" style={{ top: `${((NOW - FIRST) / HOURS) * 100}%` }}>
                      <span>10:05</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence>
            {step.phase === "enter" || step.phase === "open" ? (
              <motion.div
                key={`${step.phase}-${step.scene}`}
                className="d3-keycast"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {step.phase === "open" ? (
                  <>
                    <kbd className="d3-key" data-size="lg" data-pressed>
                      {mod}
                    </kbd>
                    <kbd className="d3-key" data-size="lg" data-pressed>
                      K
                    </kbd>
                  </>
                ) : (
                  <kbd className="d3-key" data-size="lg" data-pressed>
                    <CornerDownLeft className="d3-ico-sm" /> Enter
                  </kbd>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
  );
}

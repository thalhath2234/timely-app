"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useCalm } from "./shell";

const FEATURES = [
  {
    id: "search",
    title: "Search everything",
    keys: ["Ctrl", "K"],
    body: "Press Ctrl+K or Cmd+K, or /, anywhere. One box finds tasks, projects, docs, sheets and events, and creates new ones.",
    src: "/help/search.webp",
    alt: "The search box over the calendar with the query launch and results: a sheet, two tasks, a project and a doc.",
  },
  {
    id: "dashboard",
    title: "A dashboard you arrange",
    body: "Drag a card by its title to move it, or by an edge to resize it. Focus time, a Pomodoro timer, a daily journal, streaks and more.",
    src: "/help/dashboard.webp",
    alt: "The Dashboard with cards for open tasks, done this week, overdue, today, a Pomodoro timer reading 25:00 and open by priority.",
  },
  {
    id: "today",
    title: "Habits and goals",
    body: "Tick a habit when it is done and watch the streak. Goals stay in view on Today, next to your focus list.",
    src: "/help/today.webp",
    alt: "The Today page with habits Read 20 minutes, Spanish practice and Walk 8k steps, three goals and a Today focus list.",
  },
  {
    id: "calendar",
    title: "Calendar views",
    body: "Day, week, month and agenda, with Work blocks placed around your events and a list of what is still waiting for a slot.",
    src: "/help/calendar.webp",
    alt: "A week calendar with work blocks and events, and a Waiting for a slot list on the right.",
  },
  {
    id: "tasks",
    title: "Tasks as a list, board or Gantt",
    body: "The same tasks, three ways: a list to sort, a board to drag between stages, a Gantt chart to see what waits on what.",
    src: "/help/tasks-gantt.webp",
    alt: "Tasks shown as a Gantt chart with bars across October dates.",
  },
];

const STEP_MS = 7000;

export default function More() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const calm = useCalm();
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const playing = inView && !calm;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % FEATURES.length), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, round]);

  const current = FEATURES[index];

  return (
    <div ref={ref} className="more">
      <ul className="more-list">
        {FEATURES.map((feature, i) => {
          const on = i === index;
          return (
            <li key={feature.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-controls="d5-more-shot"
                onClick={() => {
                  setIndex(i);
                  setRound((value) => value + 1);
                }}
              >
                <span className="t">
                  {feature.title}
                  {feature.keys ? (
                    <span className="flex gap-1 text-[14px]">
                      {feature.keys.map((key) => (
                        <span key={key} className="kbd">
                          {key}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="d">{feature.body}</span>
                {on && playing ? (
                  <motion.span
                    key={`${index}-${round}`}
                    className="more-bar"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: STEP_MS / 1000, ease: "linear" }}
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div id="d5-more-shot" className="lg:sticky lg:top-[120px]">
        <div className="shot">
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.015 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <Image src={current.src} alt={current.alt} fill sizes="(min-width: 1000px) 720px, 100vw" />
            </motion.div>
          </AnimatePresence>
        </div>
        <p className="mt-3 text-[14px] text-[var(--faint)]">The real app, in its dark theme. {current.title}.</p>
      </div>
    </div>
  );
}

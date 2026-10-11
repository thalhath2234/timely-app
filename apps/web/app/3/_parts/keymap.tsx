"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useReduced } from "./motion";
import { useModKey } from "./platformKey";

const ROWS = [
  {
    id: "search",
    keys: ["mod", "K"],
    keysLabel: "Control or Command K",
    name: "Search and commands",
    line: "Find tasks, projects, docs, sheets and events, create something new, or jump to any page from one box.",
    image: "/help/search.webp",
    alt: "The search box over the calendar with the query launch and results: a sheet, two tasks, a project and a doc.",
  },
  {
    id: "dashboard",
    keys: ["g", "d"],
    keysLabel: "g then d",
    name: "Dashboard",
    line: "A grid of cards you drag and resize: Focus time, a Pomodoro timer, the Daily journal, Top 3 for today and more.",
    image: "/help/dashboard.webp",
    alt: "Dashboard with cards for open tasks, done this week, overdue, weekly completion, today, a Pomodoro timer and open by priority.",
  },
  {
    id: "today",
    keys: ["g", "y"],
    keysLabel: "g then y",
    name: "Habits and goals",
    line: "Tick a habit and watch the streak grow. Goals sit beside your Today focus list and the day's agenda.",
    image: "/help/today.webp",
    alt: "The Today page: habits and goals at the top, a Today focus list of three tasks with Start Focus buttons, and the scheduled agenda.",
  },
  {
    id: "calendar",
    keys: ["g", "c"],
    keysLabel: "g then c",
    name: "Calendar views",
    line: "Day, week, month and agenda views. Drag a block to move it by hand, or pin it so it never moves.",
    image: "/help/calendar.webp",
    alt: "Week view: coloured work blocks and events across the week, reminder chips, and the Waiting for a slot list on the right.",
  },
  {
    id: "tasks",
    keys: ["g", "t"],
    keysLabel: "g then t",
    name: "List, board and Gantt",
    line: "Saved task views that group, filter and sort, laid out as a list, a Kanban board or a Gantt timeline.",
    image: "/help/tasks-gantt.webp",
    alt: "Tasks page in Gantt layout with coloured bars over two weeks.",
  },
];

const STEP_MS = 4200;

/** A keymap you can arrow through; the screen on the right follows the selected row. */
export default function Keymap() {
  const mod = useModKey();
  const reduced = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const inView = useInView(ref, { amount: 0.4 });
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const panelId = useId();

  useEffect(() => {
    if (!inView || reduced || !auto) return;
    const timer = window.setTimeout(() => {
      setActive((value) => (value + 1) % ROWS.length);
      setTick((value) => value + 1);
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [inView, reduced, auto, active, tick]);

  const select = (index: number, focus = false) => {
    setAuto(false);
    setActive(index);
    if (focus) buttons.current[index]?.focus();
  };

  const row = ROWS[active];

  return (
    <div ref={ref} className="d3-keymap">
      <div
        role="tablist"
        aria-label="More of Timely"
        aria-orientation="vertical"
        className="d3-keymap-list"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            select((active + 1) % ROWS.length, true);
          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            select((active - 1 + ROWS.length) % ROWS.length, true);
          } else if (event.key === "Home") {
            event.preventDefault();
            select(0, true);
          } else if (event.key === "End") {
            event.preventDefault();
            select(ROWS.length - 1, true);
          }
        }}
      >
        {ROWS.map((item, index) => {
          const on = index === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${panelId}-tab-${item.id}`}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              className="d3-keymap-row"
              onClick={() => select(index)}
            >
              <span className="d3-keymap-keys" aria-label={item.keysLabel} role="img">
                {item.keys.map((key, keyIndex) => (
                  <kbd key={`${key}-${keyIndex}`} className="d3-key" data-size="sm" data-pressed={on || undefined}>
                    {key === "mod" ? mod : key}
                  </kbd>
                ))}
              </span>
              <span className="d3-keymap-text">
                <span className="d3-keymap-name">{item.name}</span>
                <span className="d3-keymap-line">{item.line}</span>
              </span>
              {on && auto && inView && !reduced ? (
                <motion.span
                  key={tick}
                  className="d3-keymap-progress"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: STEP_MS / 1000, ease: "linear" }}
                />
              ) : null}
            </button>
          );
        })}
        <p className="d3-keymap-hint" aria-hidden>
          <kbd className="d3-key" data-size="sm">↑</kbd>
          <kbd className="d3-key" data-size="sm">↓</kbd>
          to move through the list
        </p>
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${row.id}`} className="d3-keymap-panel">
        <div className="d3-shot-bar" aria-hidden>
          <span>{row.name}</span>
          <span className="d3-term-dim">{row.keys.map((key) => (key === "mod" ? mod : key)).join(" ")}</span>
        </div>
        <div className="d3-shot">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={row.id}
              className="d3-shot-img"
              initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Image src={row.image} alt={row.alt} width={1920} height={1200} sizes="(min-width: 1100px) 720px, 100vw" />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

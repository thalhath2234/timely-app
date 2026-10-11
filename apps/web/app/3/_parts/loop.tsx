"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Flame, Inbox, Play, Sparkles } from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { Keys } from "./kbd";
import { useLoop, useReduced } from "./motion";

const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

function Keycast({ keys, show }: { keys: string[]; show: boolean }) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="d3-keycast d3-keycast-sm"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
        >
          {keys.map((key, index) => (
            <kbd key={`${key}-${index}`} className="d3-key" data-pressed>
              {key}
            </kbd>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function AppFrame({ title, route, children }: { title: string; route: string; children: ReactNode }) {
  return (
    <div className="d3-app">
      <div className="d3-app-bar">
        <TimelyLogo size={16} />
        <span className="d3-app-title">{title}</span>
        <span className="d3-app-route">{route}</span>
      </div>
      <div className="d3-app-body">{children}</div>
    </div>
  );
}

/* ---- 1. Capture ---- */

const TYPED = ["", "", "Book", "Book flights", "Book flights for", "Book flights for December", "", ""];
const INBOX = ["Call the dentist", "Q3 investor update", "Fix onboarding copy"];

function CaptureScreen() {
  const { ref, frame } = useLoop(8, [700, 500, 260, 260, 260, 700, 900, 2400], 7);
  const added = frame >= 6;
  const items = added ? ["Book flights for December", ...INBOX] : INBOX;
  return (
    <div ref={ref} className="d3-screen">
      <AppFrame title="Inbox" route="g i">
        <div className="d3-capture" data-focus={(frame >= 1 && frame <= 5) || undefined}>
          <Inbox className="d3-ico-sm" />
          <span className="d3-capture-text">
            {TYPED[frame] || <span className="d3-term-dim">Capture a thought…</span>}
            {frame >= 1 && frame <= 5 ? <span className="d3-caret d3-caret-sm" /> : null}
          </span>
        </div>
        <ul className="d3-inbox">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
              >
                <span className="d3-inbox-row" data-new={(added && item.startsWith("Book")) || undefined}>
                  <span className="d3-inbox-dot" />
                  <span className="d3-inbox-title">{item}</span>
                  <span className="d3-inbox-review">Review</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <p className="d3-screen-note">No date, no length, no project. Auto-schedule leaves it alone.</p>
      </AppFrame>
      <Keycast keys={frame === 5 ? ["Enter"] : ["c"]} show={frame === 0 || frame === 1 || frame === 5} />
    </div>
  );
}

/* ---- 2. Clarify ---- */

const CLARIFY = [
  { label: "Workspace", value: "Personal", suggested: false },
  { label: "Duration", value: "30m", suggested: false },
  { label: "Deadline", value: "Fri 30 Oct", suggested: true },
  { label: "Project", value: "Travel", suggested: true },
  { label: "Labels", value: "trips", suggested: true },
  { label: "Priority", value: "Medium", suggested: false },
];

function ClarifyScreen() {
  const { ref, frame } = useLoop(7, [900, 500, 500, 500, 900, 600, 2400], 6);
  const filled = frame >= 4 ? 3 : Math.max(0, frame - 0);
  let suggestedSeen = 0;
  return (
    <div ref={ref} className="d3-screen">
      <AppFrame title="Clarify" route="Inbox › Review">
        <p className="d3-clar-title">Book flights for December</p>
        <div className="d3-seg" role="presentation">
          <span data-on>Work</span>
          <span>Reminder</span>
        </div>
        <dl className="d3-clar-grid">
          {CLARIFY.map((field) => {
            const order = field.suggested ? ++suggestedSeen : 0;
            const shown = !field.suggested || order <= filled;
            const ghost = field.suggested && frame < 4;
            return (
              <div key={field.label} className="d3-clar-field">
                <dt>{field.label}</dt>
                <dd data-ghost={(shown && ghost) || undefined}>
                  {shown ? (
                    <motion.span
                      key={`${field.label}-${shown}`}
                      initial={field.suggested ? { opacity: 0, y: 4 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={spring}
                    >
                      {field.suggested ? <Sparkles className="d3-ico-xs" /> : null}
                      {field.value}
                    </motion.span>
                  ) : (
                    <span className="d3-term-dim">—</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className="d3-clar-foot">
          <span className="d3-term-dim">{frame >= 6 ? "Saved · it left the Inbox" : "Nothing changes until you save"}</span>
          <span className="d3-fake-btn d3-fake-amber" data-pressed={frame === 5 || undefined} data-done={frame >= 6 || undefined}>
            {frame >= 6 ? <Check className="d3-ico-sm" strokeWidth={2.6} /> : null}
            {frame >= 6 ? "Saved" : "Save"}
          </span>
        </div>
      </AppFrame>
    </div>
  );
}

/* ---- 3. Auto-schedule ---- */

const MINI_DAYS = ["Mon 12", "Tue 13", "Wed 14"];
const MINI_EVENTS = [
  { day: 0, from: 0, to: 1, title: "Standup" },
  { day: 1, from: 3, to: 5, title: "1:1 with Sam" },
  { day: 2, from: 1.5, to: 3.5, title: "Design review" },
  { day: 0, from: 4.5, to: 6, title: "Hiring sync" },
];
const MINI_BLOCKS = [
  { day: 0, from: 1.3, to: 3.3, title: "Launch brief 1/2" },
  { day: 1, from: 0, to: 2.5, title: "Launch brief 2/2" },
  { day: 2, from: 4, to: 5, title: "Book flights" },
  { day: 1, from: 5.5, to: 7, title: "Q3 budget" },
];
const MINI_ROWS = 8;

function ScheduleScreen() {
  const { ref, frame } = useLoop(9, [900, 1300, 600, 300, 300, 300, 300, 900, 2600], 8);
  const placed = frame >= 3 ? Math.min(frame - 2, MINI_BLOCKS.length) : 0;
  const preview = frame >= 1 && frame <= 2;
  return (
    <div ref={ref} className="d3-screen">
      <AppFrame title="Calendar" route="g c">
        <div className="d3-mini-top">
          <span className="d3-term-dim">Working hours 09:00–17:30</span>
          <span className="d3-fake-btn d3-fake-sm" data-pressed={frame === 0 || undefined}>
            Auto-schedule <b>4</b>
          </span>
        </div>
        <div className="d3-mini">
          {MINI_DAYS.map((day, dayIndex) => (
            <div key={day} className="d3-mini-col">
              <p className="d3-mini-day">{day}</p>
              <div className="d3-mini-body">
                {MINI_EVENTS.filter((event) => event.day === dayIndex).map((event) => (
                  <span
                    key={event.title}
                    className="d3-event"
                    style={{ top: `${(event.from / MINI_ROWS) * 100}%`, height: `${((event.to - event.from) / MINI_ROWS) * 100}%` }}
                  >
                    <span>{event.title}</span>
                  </span>
                ))}
                {MINI_BLOCKS.map((block, index) =>
                  block.day === dayIndex && index < placed ? (
                    <motion.span
                      key={block.title}
                      className="d3-block"
                      initial={{ opacity: 0, y: -18, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={spring}
                      style={{ top: `${(block.from / MINI_ROWS) * 100}%`, height: `${((block.to - block.from) / MINI_ROWS) * 100}%` }}
                    >
                      <span className="d3-block-title">{block.title}</span>
                    </motion.span>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
        <AnimatePresence>
          {preview ? (
            <motion.div
              className="d3-preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2 }}
            >
              <p>
                <b>4 added</b> · 0 moved · nothing left over
              </p>
              <p className="d3-term-dim">Mon 72% · Tue 88% · Wed 61%</p>
              <span className="d3-fake-btn d3-fake-amber d3-fake-sm" data-pressed={frame === 2 || undefined}>
                Apply schedule
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AppFrame>
      <Keycast keys={["g", "c"]} show={frame === 0} />
    </div>
  );
}

/* ---- 4. Focus ---- */

const FOCUS = [
  { title: "Launch brief", length: "2h" },
  { title: "Book flights for December", length: "30m" },
  { title: "Q3 budget", length: "1h 30m" },
];

function Elapsed({ running }: { running: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const shown = running ? seconds : 25 * 60 + 12;
  return (
    <>
      {String(Math.floor(shown / 60)).padStart(2, "0")}:{String(shown % 60).padStart(2, "0")}
    </>
  );
}

function FocusScreen() {
  const reduced = useReduced();
  const { ref, frame, inView } = useLoop(3, [1000, 700, 9000], 2);
  const running = frame === 2;
  return (
    <div ref={ref} className="d3-screen">
      <AppFrame title="Today" route="g y">
        <div className="d3-habits">
          <span>
            <Flame className="d3-ico-xs" /> Read <b>12</b>
          </span>
          <span>
            <Flame className="d3-ico-xs" /> Walk <b>5</b>
          </span>
          <span data-done>
            <Check className="d3-ico-xs" /> Inbox zero
          </span>
        </div>
        <p className="d3-today-label">Today focus</p>
        <ul className="d3-today">
          {FOCUS.map((task, index) => (
            <li key={task.title} className="d3-today-row" data-on={(index === 0 && running) || undefined}>
              <span className="d3-today-title">{task.title}</span>
              <span className="d3-term-dim">{task.length}</span>
              {index === 0 && running ? (
                <span className="d3-today-timer">
                  <span className="d3-rec" />
                  <Elapsed running={!reduced && inView} />
                </span>
              ) : (
                <span className="d3-fake-btn d3-fake-sm" data-pressed={(index === 0 && frame === 1) || undefined}>
                  <Play className="d3-ico-xs" /> Start Focus
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="d3-screen-note">One task in focus at a time. Stop, and the minutes go to the task.</p>
      </AppFrame>
      <Keycast keys={["g", "y"]} show={frame === 0} />
    </div>
  );
}

const SCREENS = [CaptureScreen, ClarifyScreen, ScheduleScreen, FocusScreen];

/* ---- The section's steps ---- */

const STEPS: { id: string; name: string; keys: string[]; keysLabel: string; title: string; body: ReactNode }[] = [
  {
    id: "capture",
    name: "Capture",
    keys: ["g", "i", "c"],
    keysLabel: "g then i, then c",
    title: "Get it out of your head.",
    body: (
      <>
        In the Inbox, <kbd className="d3-key" data-size="sm">c</kbd> jumps to the capture box: type, press Enter. A
        title is enough. Inbox items have no date, length or project, and Auto-schedule leaves them alone. On the
        phone, it&apos;s the <b>+</b> button.
      </>
    ),
  },
  {
    id: "clarify",
    name: "Clarify",
    keys: [],
    keysLabel: "",
    title: "Decide what it is, when you have a minute.",
    body: (
      <>
        Work takes time, a Reminder is a ping at a time. Give Work a workspace and a length, and if you like a
        project, priority, deadline and labels. With smart suggestions on, Clarify reads &ldquo;before Friday&rdquo;
        and fills in the dates for you.
      </>
    ),
  },
  {
    id: "schedule",
    name: "Auto-schedule",
    keys: ["g", "c"],
    keysLabel: "g then c",
    title: "Let the week arrange itself.",
    body: (
      <>
        Auto-schedule puts open Work in the earliest free time that fits, most urgent first, around your events and
        inside your working hours. Long tasks split into chunks. Read the preview, choose <b>Apply schedule</b>, and{" "}
        <b>Undo last apply</b> if you change your mind.
      </>
    ),
  },
  {
    id: "focus",
    name: "Focus",
    keys: ["g", "y"],
    keysLabel: "g then y",
    title: "Then do one thing.",
    body: (
      <>
        Today shows your focus list, habits and the day&apos;s agenda. <b>Start Focus</b> on a task to time it; when
        you stop, the minutes go to the task and to the Dashboard&apos;s Focus time card.
      </>
    ),
  },
];

export default function LoopStory() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const node of stepRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Screen = SCREENS[active];

  return (
    <div className="d3-loop">
      <div className="d3-loop-sticky" aria-hidden>
        <div className="d3-loop-rail">
          {STEPS.map((step, index) => (
            <span key={step.id} data-on={index === active || undefined} data-done={index < active || undefined}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              {step.name}
            </span>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <Screen />
          </motion.div>
        </AnimatePresence>
      </div>

      <ol className="d3-loop-steps">
        {STEPS.map((step, index) => {
          const InlineScreen = SCREENS[index];
          return (
            <li
              key={step.id}
              ref={(node) => {
                stepRefs.current[index] = node;
              }}
              data-index={index}
              data-on={index === active || undefined}
              className="d3-loop-step"
            >
              <p className="d3-loop-num">
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step.name}
                {step.keys.length ? <Keys keys={step.keys} size="sm" label={step.keysLabel} /> : null}
              </p>
              <h3 className="d3-h3 d3-loop-title">{step.title}</h3>
              <p className="d3-loop-body">{step.body}</p>
              <div className="d3-loop-inline" aria-hidden>
                <InlineScreen />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

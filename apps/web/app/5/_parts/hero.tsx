"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { useCalm } from "./shell";

/** Rounded so the server and the browser print the same coordinates. */
const fx = (n: number) => Math.round(n * 100) / 100;

/* One loop: a thought is typed, placed on Monday, focused on for 25 minutes, then a 5 minute break. */
const THOUGHT = "Write the launch brief before Tuesday";
const DURATIONS = [3600, 3000, 15000, 4800] as const;
const TOTAL = DURATIONS.reduce((sum, ms) => sum + ms, 0);
const STARTS = DURATIONS.map((_, i) => DURATIONS.slice(0, i).reduce((sum, ms) => sum + ms, 0));

type Phase = 0 | 1 | 2 | 3;

/** The resting frame (also the first paint and the reduced-motion view): mid-session. */
const REST = {
  phase: 2 as Phase,
  typed: THOUGHT.length,
  minutes: 18,
  progress: 0.28,
  session: 1,
};

const R = 168;
const C = 200;

/* Monday 12 October, 08:00 to 18:00. */
const DAY_START = 8;
const DAY_HOURS = 10;
const pct = (hour: number) => `${((hour - DAY_START) / DAY_HOURS) * 100}%`;
const width = (from: number, to: number) => `${((to - from) / DAY_HOURS) * 100}%`;

const EVENTS = [
  { from: 9, to: 9.75, title: "Weekly planning" },
  { from: 12.5, to: 13.25, title: "Lunch" },
  { from: 15, to: 16, title: "Client review" },
];
const BLOCK = { from: 10.75, to: 12.25 };

function Lane({ phase, progress }: { phase: Phase; progress: number }) {
  const placed = phase !== 0;
  // The now-line walks through the block while the timer runs.
  const now =
    phase === 2 ? BLOCK.from + (25 / 60) * progress : phase === 3 ? BLOCK.from + 25 / 60 + (5 / 60) * progress : null;
  return (
    <div className="lane" aria-hidden>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-semibold text-[var(--ink)]">Mon 12 Oct</span>
        <span className="faint">Working hours 09:00 – 17:00</span>
      </div>
      <div className="lane-track">
        <div className="lane-hours" style={{ left: 0, right: 0 }} />
        <div className="lane-work" style={{ left: pct(9), width: width(9, 17) }} />
        {EVENTS.map((event) => (
          <div
            key={event.title}
            className="lane-block lane-meeting"
            title={event.title}
            style={{
              left: pct(event.from),
              width: width(event.from, event.to),
            }}
          />
        ))}
        <AnimatePresence initial={false}>
          {placed ? (
            <motion.div
              key="block"
              className="lane-block lane-focus"
              style={{
                left: pct(BLOCK.from),
                width: width(BLOCK.from, BLOCK.to),
              }}
              initial={{ y: -46, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.6 } }}
              transition={{ type: "spring", stiffness: 140, damping: 18 }}
            >
              <span className="lane-label">Launch brief</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {now !== null ? <span className="lane-now" style={{ left: pct(now) }} /> : null}
      </div>
      <div className="lane-axis num">
        {[8, 10, 12, 14, 16, 18].map((hour) => (
          <span
            key={hour}
            style={{
              left: pct(hour),
              transform: hour === 8 ? "none" : hour === 18 ? "translateX(-100%)" : undefined,
            }}
          >
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>
      <div className="lane-legend">
        <span>
          <i style={{ background: "var(--meeting)" }} />
          Meetings
        </span>
        <span>
          <i style={{ border: "1px dashed rgb(168 224 195 / 40%)" }} />
          Working hours
        </span>
        <span>
          <i style={{ background: "var(--mint)" }} />
          Placed by Auto-schedule
        </span>
      </div>
    </div>
  );
}

function Dial() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const calm = useCalm();
  const [phase, setPhase] = useState<Phase>(REST.phase);
  const [typed, setTyped] = useState(REST.typed);
  const [minutes, setMinutes] = useState(REST.minutes);
  const [session, setSession] = useState(REST.session);
  const [laneProgress, setLaneProgress] = useState(REST.progress);
  const progress = useMotionValue(REST.progress);
  const elapsed = useRef<number | null>(null);
  const knobX = useTransform(progress, (p) => C + R * Math.sin(p * Math.PI * 2));
  const knobY = useTransform(progress, (p) => C - R * Math.cos(p * Math.PI * 2));

  useEffect(() => {
    if (!inView || calm) return;
    let raf = 0;
    const origin = performance.now() - (elapsed.current ?? 0);
    let lastCycle = -1;
    const step = (now: number) => {
      const total = now - origin;
      elapsed.current = total;
      const cycle = Math.floor(total / TOTAL);
      const t = total % TOTAL;
      const p = (t >= STARTS[3] ? 3 : t >= STARTS[2] ? 2 : t >= STARTS[1] ? 1 : 0) as Phase;
      const local = (t - STARTS[p]) / DURATIONS[p];
      if (cycle !== lastCycle) {
        lastCycle = cycle;
        setSession(cycle % 4);
      }
      setPhase(p);
      if (p === 0) {
        setTyped(Math.min(THOUGHT.length, Math.floor((local / 0.72) * THOUGHT.length)));
        progress.set(0);
        setMinutes(25);
      } else if (p === 1) {
        progress.set(0);
        setMinutes(25);
      } else {
        const span = p === 2 ? 25 : 5;
        progress.set(local);
        setMinutes(Math.ceil(span * (1 - local)));
        setLaneProgress(Math.round(local * 40) / 40);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, calm, progress]);

  const onBreak = phase === 3;
  const color = onBreak ? "var(--sand)" : "var(--mint)";
  const digits = `${String(minutes).padStart(2, "0")}:00`;

  return (
    <div ref={ref}>
      <div
        className="dial"
        role="img"
        aria-label="Animation: a thought typed into the Inbox is placed on Monday from 10:45 to 12:15, between meetings and inside working hours. A 25 minute focus timer fills the ring, then a 5 minute break."
      >
        <svg viewBox="0 0 400 400" className="dial-svg" aria-hidden>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const long = i % 5 === 0;
            const r1 = 199;
            const r2 = long ? 189 : 194;
            return (
              <line
                key={i}
                x1={fx(C + Math.sin(a) * r1)}
                y1={fx(C - Math.cos(a) * r1)}
                x2={fx(C + Math.sin(a) * r2)}
                y2={fx(C - Math.cos(a) * r2)}
                stroke={long ? "rgb(190 225 205 / 34%)" : "rgb(190 225 205 / 15%)"}
                strokeWidth={long ? 1.6 : 1}
                strokeLinecap="round"
              />
            );
          })}
          <circle
            className="breathe"
            cx={C}
            cy={C}
            r={180}
            fill="none"
            stroke="rgb(168 224 195 / 14%)"
            strokeWidth="1"
          />
          <circle cx={C} cy={C} r={R} fill="rgb(16 28 24 / 55%)" stroke="rgb(190 225 205 / 10%)" strokeWidth="5" />
          <motion.circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            transform={`rotate(-90 ${C} ${C})`}
            style={{ pathLength: progress, transition: "stroke 0.8s ease" }}
          />
          <motion.circle
            cx={knobX}
            cy={knobY}
            r="9"
            fill="#0a1210"
            stroke={color}
            strokeWidth="3"
            style={{ transition: "stroke 0.8s ease" }}
          />
        </svg>

        <div className="dial-center" aria-hidden>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              className="flex w-full flex-col items-center"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {phase === 0 ? (
                <>
                  <p className="label">Inbox · new thought</p>
                  <p className="dial-typed mt-3 max-w-[15ch]">
                    {THOUGHT.slice(0, typed)}
                    <span className="caret" />
                  </p>
                  <p className="dial-cap">
                    <span className="kbd">Enter</span> to capture
                  </p>
                </>
              ) : phase === 1 ? (
                <>
                  <p className="label">Auto-schedule</p>
                  <p className="dial-digits num mt-2 !text-[clamp(2.6rem,8vw,4.4rem)]">Mon 10:45</p>
                  <p className="dial-cap">Placed until 12:15 · 1h 30m · Website refresh</p>
                </>
              ) : (
                <>
                  <p className="label" style={{ color: onBreak ? "var(--sand)" : "var(--mint)" }}>
                    {onBreak ? "Short break" : "Focus"}
                  </p>
                  <p className="dial-digits num mt-2">{digits}</p>
                  <p className="dial-cap">
                    {onBreak ? "Stand up. Look away from the screen." : "Write the launch brief"}
                  </p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-3 text-[13px] text-[var(--faint)]" aria-hidden>
        <span className="session-dots">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} data-on={i < session || (i === session && phase >= 2)} />
          ))}
        </span>
        <span className="num">Session {session + 1} of 4</span>
      </div>

      <Lane phase={phase} progress={laneProgress} />
    </div>
  );
}

export default function Hero() {
  return (
    <section className="wrap hero" data-phase="Ready · 25:00" aria-labelledby="d5-hero-title">
      <div>
        <p className="label mb-6 flex items-center gap-2.5">
          <span className="inline-block size-1.5 rounded-full bg-[var(--mint)]" />A private planner for focused work
        </p>
        <h1 id="d5-hero-title">
          Write it down.
          <span className="it">Timely finds the hour.</span>
        </h1>
        <p className="hero-lead">
          Capture a thought the moment it arrives. Timely places it on your week, around your meetings and inside your
          working hours, so when the block comes up you can simply start.
        </p>
        <div className="hero-actions">
          <Link href="/signup" className="btn btn-mint">
            Register
            <ArrowRight className="size-4" />
          </Link>
          <Link href="/login" className="btn btn-line">
            Log in
          </Link>
          <a href={REPO_URL} className="btn btn-line">
            <GitHubMark className="size-[18px]" />
            GitHub
          </a>
        </div>
        <div className="hero-meta">
          <span>Open source</span>
          <span>Runs on your own computer</span>
          <span>Windows, Ubuntu, Arch, Android</span>
        </div>
      </div>
      <Dial />
    </section>
  );
}

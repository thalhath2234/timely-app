"use client";

import { useRef, type ReactNode } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { Ring, clock } from "./ring";

/**
 * A work interval of the page. The rail timer runs down from 25:00 as you
 * read through the section: scroll is the clock.
 */
export function WorkSection({
  id,
  session,
  minutes = 25,
  kind = "Work",
  color = "var(--mint)",
  title,
  lead,
  children,
}: {
  id: string;
  session?: number;
  minutes?: number;
  kind?: string;
  color?: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.75", "end 0.6"],
  });
  const remaining = useTransform(scrollYProgress, (p) => clock(minutes * 60 * (1 - p)));
  const start = clock(minutes * 60);
  const phase = session ? `${kind} · ${session} of 4` : kind;

  return (
    <section ref={ref} id={id} className="sec" data-phase={phase} aria-labelledby={`${id}-title`}>
      <div className="wrap sec-grid">
        <div className="sec-rail">
          <div className="rail-ring">
            <Ring progress={scrollYProgress} size={148} stroke={2.4} color={color} ticks={60} className="!size-full" />
            <motion.span className="rail-time num" aria-hidden>
              {remaining}
            </motion.span>
          </div>
          <div className="rail-text">
            <p style={{ color }}>{kind}</p>
            <p className="num">
              {session ? `Session ${session} of 4 · ` : ""}
              {start}
            </p>
          </div>
        </div>
        <div className="min-w-0">
          <header className="sec-head">
            <h2 id={`${id}-title`}>{title}</h2>
            {lead ? <p className="lead">{lead}</p> : null}
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}

/** A short break between sections: one line to read while the circle breathes. */
export function BreakBand({
  time = "05:00",
  label = "Short break",
  line,
}: {
  time?: string;
  label?: string;
  line: ReactNode;
}) {
  return (
    <aside className="brk" data-phase={`${label} · ${time}`} aria-label={label}>
      <div className="wrap brk-row">
        <span className="brk-orb" aria-hidden />
        <div className="min-w-0">
          <p className="brk-time num">
            {label} · {time}
          </p>
          <p className="brk-line">{line}</p>
        </div>
        <p className="brk-breath" aria-hidden>
          Breathe with the circle
        </p>
      </div>
    </aside>
  );
}

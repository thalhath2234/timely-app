"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Hand } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { Tape, noteStyle, type NoteColor } from "./paper";

type Feature = {
  title: string;
  body: string;
  color: NoteColor;
  rotate: number;
  shift: string;
  art: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "Search everything",
    body: "One box for tasks, events, docs, sheets and commands.",
    color: "yellow",
    rotate: -3,
    shift: "lg:translate-y-6",
    art: (
      <span className="flex items-center gap-1.5">
        <kbd className="rounded-md border-[1.5px] border-b-[3px] border-[var(--paper-ink)] bg-white/50 px-2 font-mono text-sm font-bold">Ctrl</kbd>
        <span className="font-bold">/</span>
        <kbd className="rounded-md border-[1.5px] border-b-[3px] border-[var(--paper-ink)] bg-white/50 px-2 font-mono text-sm font-bold">Cmd</kbd>
        <span className="font-bold">+</span>
        <kbd className="rounded-md border-[1.5px] border-b-[3px] border-[var(--paper-ink)] bg-white/50 px-2 font-mono text-sm font-bold">K</kbd>
      </span>
    ),
  },
  {
    title: "A dashboard you arrange",
    body: "Drag and resize cards: focus time, a Pomodoro timer, a daily journal, habits and more.",
    color: "pink",
    rotate: 2.5,
    shift: "",
    art: (
      <span className="grid h-12 w-28 grid-cols-3 grid-rows-2 gap-1">
        <span className="col-span-2 rounded-[3px] bg-[var(--paper-ink)]/80" />
        <span className="row-span-2 rounded-[3px] bg-[var(--paper-ink)]/35" />
        <span className="rounded-[3px] bg-[var(--paper-ink)]/35" />
        <span className="rounded-[3px] bg-[var(--paper-ink)]/60" />
      </span>
    ),
  },
  {
    title: "Habits and goals",
    body: "Tick today's habits, keep the streak going, and keep bigger goals in view on Today.",
    color: "green",
    rotate: -1.5,
    shift: "lg:translate-y-10",
    art: (
      <span className="flex flex-wrap gap-1.5 text-[0.78rem] font-bold">
        <span className="rounded-full bg-[var(--paper-ink)] px-2 py-0.5 text-[var(--n-green)]">✓ Read</span>
        <span className="rounded-full bg-[var(--paper-ink)] px-2 py-0.5 text-[var(--n-green)]">✓ Walk</span>
        <span className="rounded-full border-[1.5px] border-[var(--paper-ink)] px-2 py-0.5">12-day streak</span>
      </span>
    ),
  },
  {
    title: "Calendar views",
    body: "Day, week, month and agenda, with your blocks and events side by side.",
    color: "blue",
    rotate: 1.8,
    shift: "lg:-translate-y-2",
    art: (
      <span className="flex gap-1 text-[0.75rem] font-bold">
        {["Day", "Week", "Month", "Agenda"].map((view) => (
          <span
            key={view}
            className={cn("rounded-md px-2 py-0.5", view === "Week" ? "bg-[var(--paper-ink)] text-[var(--n-blue)]" : "border-[1.5px] border-[var(--paper-ink)]/40")}
          >
            {view}
          </span>
        ))}
      </span>
    ),
  },
  {
    title: "Tasks, three ways",
    body: "A list, a board, or a Gantt chart, with stages for each project.",
    color: "orange",
    rotate: -2.2,
    shift: "lg:translate-y-4",
    art: (
      <span className="flex h-12 w-32 flex-col justify-center gap-1">
        <span className="ml-0 h-2 w-14 rounded-full bg-[var(--paper-ink)]/80" />
        <span className="ml-8 h-2 w-16 rounded-full bg-[var(--paper-ink)]/55" />
        <span className="ml-16 h-2 w-12 rounded-full bg-[var(--paper-ink)]/35" />
      </span>
    ),
  },
];

function FeatureNote({ feature }: { feature: Feature }) {
  return (
    <div className={cn("relative", feature.shift)}>
      <motion.article
        drag
        dragSnapToOrigin
        dragElastic={0.55}
        dragTransition={{ bounceStiffness: 260, bounceDamping: 14 }}
        whileDrag={{ scale: 1.06, rotate: 0, zIndex: 40, boxShadow: "0 30px 40px -18px rgb(0 0 0 / 0.85)" }}
        whileHover={{ rotate: feature.rotate * 0.4, y: -3 }}
        initial={false}
        style={noteStyle(feature.color, 0)}
        animate={{ rotate: feature.rotate }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="d6-note d6-grab relative flex min-h-[220px] flex-col p-5 select-none"
      >
        <div className="flex h-12 items-center">{feature.art}</div>
        <h3 className="d6-display mt-4 text-[1.35rem] leading-tight font-extrabold">{feature.title}</h3>
        <p className="mt-1.5 text-[0.95rem] leading-snug font-medium text-[var(--paper-soft)]">{feature.body}</p>
      </motion.article>
    </div>
  );
}

export default function FeatureNotes() {
  return (
    <div className="mt-12">
      <p className="d6-faint flex items-center gap-2 text-sm">
        <Hand className="size-4" />
        Pick a note up and drag it. It goes back where it was.
      </p>
      <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.slice(0, 2).map((feature) => (
          <FeatureNote key={feature.title} feature={feature} />
        ))}
        <figure className="relative sm:row-span-2 lg:row-span-1 lg:translate-y-3">
          <div className="relative rotate-[2deg] bg-[#f4f1ea] p-2.5 pb-10 shadow-[0_24px_40px_-20px_rgb(0_0_0/0.9)]">
            <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-4deg]" />
            <Image
              src="/help/dashboard.webp"
              alt="Timely's Dashboard: cards for open tasks, done this week, overdue, weekly completion, today, a Pomodoro timer and open by priority."
              width={1920}
              height={1200}
              sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 100vw"
              className="block h-auto w-full"
            />
            <figcaption className="d6-hand absolute inset-x-0 bottom-2 text-center text-[1.1rem] font-bold text-[var(--paper-ink)]">
              the real Dashboard, dark theme
            </figcaption>
          </div>
        </figure>
        {FEATURES.slice(2).map((feature) => (
          <FeatureNote key={feature.title} feature={feature} />
        ))}
      </div>
    </div>
  );
}

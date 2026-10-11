"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, Plus } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { PALETTE } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";
import { Card, Checkbox, Meter, Num, Ring } from "./card";

/**
 * The hero: a live copy of Timely's Dashboard. One loop runs the morning:
 * the first task gets ticked, focus time grows, the Inbox counts down to
 * zero, then a habit, the goal and the week catch up. Reduced motion rests
 * on the finished state.
 */
const FRAMES = [1800, 1100, 700, 700, 700, 1300, 1500, 3600] as const;

const TOP3 = ["Launch brief", "Send invoices", "Call the landlord"];
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const TODAY = 3; // Thursday

const JOURNAL = "Brief done before lunch. Took the long way back from the bakery.";

function Cell({
  children,
  index,
  className,
}: {
  children: ReactNode;
  index: number;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("flex min-w-0", className)}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.15 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function HeroBoard() {
  const { ref, frame } = useLoop(FRAMES.length, FRAMES, FRAMES.length - 1);
  const ticked = frame >= 1;
  const focusMinutes = ticked ? 135 : 100;
  const inbox = Math.max(0, 4 - Math.max(0, frame - 1));
  const later = frame >= 6;
  const goal = later ? 13 : 12;
  const bars = [190, 225, 170, later ? 135 : 100, 0, 0, 0];

  return (
    <div ref={ref} className="v5-grid" style={{ "--cols-sm": 2, "--cols-md": 3, "--cols-lg": 3 } as CSSProperties} aria-label="A live example of the Timely dashboard">
      <Cell index={0} className="v5-span-2">
        <Card title="Next up" right="Thu 15 Oct" className="w-full">
          <ul className="space-y-1.5 text-sm">
            {[
              { time: "10:00", title: "Write the launch brief", meta: "Website refresh · 2h", color: PALETTE.violet, now: true },
              { time: "14:00", title: "Call the landlord", meta: "Reminder", color: PALETTE.amber },
              { time: "16:00", title: "Plan next week", meta: "Personal · 30m", color: PALETTE.green },
            ].map((item) => (
              <li key={item.title} className="flex items-center gap-2.5">
                <span className="w-11 shrink-0 text-xs text-[var(--v-soft)] tabular-nums">{item.time}</span>
                <span className="h-4 w-0.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {item.title}
                  <span className="ml-2 hidden text-xs text-[var(--v-faint)] sm:inline">{item.meta}</span>
                </span>
                {item.now ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--v-primary)]">
                    <span className="v5-pulse" aria-hidden />
                    in 12 min
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </Cell>

      <Cell index={1}>
        <Card title="Focus time" right="of 4h" className="w-full">
          <div className="flex items-center gap-3">
            <Ring value={focusMinutes / 240} className="hidden [--size:3.75rem] sm:block" stroke={7} />
            <div className="min-w-0 flex-1">
              <Num className="!text-[1.75rem] whitespace-nowrap" color={PALETTE.primary}>
                <span key={focusMinutes} className="v5-pop">
                  {Math.floor(focusMinutes / 60)}h {focusMinutes % 60}m
                </span>
              </Num>
              <p className="mt-1.5 text-xs text-[var(--v-soft)]">{ticked ? "2 of 3 sessions" : "1 of 3 sessions"}</p>
              <span className="mt-2.5 block sm:hidden">
                <Meter value={focusMinutes / 240} color={PALETTE.primary} />
              </span>
            </div>
          </div>
        </Card>
      </Cell>

      <Cell index={2}>
        <Card title="Top 3" right={`${ticked ? 1 : 0}/3`} className="w-full">
          <ul className="space-y-2 text-sm">
            {TOP3.map((task, index) => {
              const done = index === 0 && ticked;
              return (
                <li key={task} className="flex items-center gap-2.5">
                  <Checkbox on={done} />
                  <span className={cn("min-w-0 truncate transition-colors", done && "text-[var(--v-faint)] line-through")}>{task}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </Cell>

      <Cell index={3}>
        <Card title="Habits" right="Run" className="w-full">
          <div className="flex items-end justify-between gap-3">
            <Num color={PALETTE.green} unit="day streak">
              <span key={later ? 7 : 6} className="v5-pop">
                {later ? 7 : 6}
              </span>
            </Num>
          </div>
          <div className="mt-3 flex items-center justify-between" aria-hidden>
            {DAYS.map((day, index) => (
              <span key={index} className="flex flex-col items-center gap-1">
                <span
                  className="v5-dot"
                  data-on={index < TODAY || (index === TODAY && later)}
                  data-today={index === TODAY}
                  style={{ "--c": PALETTE.green } as CSSProperties}
                />
                <span className="text-[0.625rem] font-medium text-[var(--v-faint)]">{day}</span>
              </span>
            ))}
          </div>
        </Card>
      </Cell>

      <Cell index={4}>
        <Card title="Inbox" right={inbox === 0 ? "clear" : "to clarify"} className="w-full">
          <div className="flex items-center gap-3">
            <Num color={inbox === 0 ? PALETTE.green : PALETTE.amber} unit={inbox === 0 ? undefined : "in Inbox"}>
              <span key={inbox} className="v5-pop">
                {inbox}
              </span>
            </Num>
            {inbox === 0 ? (
              <span className="v5-pop flex size-7 items-center justify-center rounded-full text-[var(--v-primary-ink)]" style={{ background: PALETTE.green }} aria-hidden>
                <Check className="size-4" strokeWidth={3} />
              </span>
            ) : null}
          </div>
          <p className="v5-caption">{inbox === 0 ? "Inbox zero. Everything has a length or a time." : "Smart suggestions have filled in the details."}</p>
        </Card>
      </Cell>

      <Cell index={5} className="hidden sm:flex">
        <Card title="Goal" right="Ship v1.0" className="w-full">
          <div className="flex items-center gap-3">
            <Ring value={goal / 18} className="[--size:3.75rem]" stroke={7} color={PALETTE.teal}>
              <span className="text-[0.7rem] font-semibold tabular-nums">{Math.round((goal / 18) * 100)}%</span>
            </Ring>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <span key={goal} className="v5-pop tabular-nums">
                  {goal}
                </span>{" "}
                of 18 steps
              </p>
              <p className="mt-1 text-xs text-[var(--v-soft)]">Due 31 Oct · on track</p>
            </div>
          </div>
        </Card>
      </Cell>

      <Cell index={6} className="hidden sm:flex">
        <Card title="Weekly review" right="12h 40m" className="w-full">
          <div className="flex h-12 items-end gap-1.5" aria-hidden>
            {bars.map((minutes, index) => (
              <span key={index} className="flex h-full flex-1 flex-col justify-end">
                <span
                  className={cn("v5-bar", index === TODAY ? "" : "opacity-70")}
                  style={{ height: `${Math.max(4, (minutes / 240) * 100)}%`, "--c": index === TODAY ? PALETTE.primary : PALETTE.blue } as CSSProperties}
                />
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[0.625rem] font-medium text-[var(--v-faint)]" aria-hidden>
            {DAYS.map((day, index) => (
              <span key={index} className="flex-1 text-center">
                {day}
              </span>
            ))}
          </div>
        </Card>
      </Cell>

      <Cell index={7}>
        <PomodoroCard />
      </Cell>

      <Cell index={8} className="v5-span-2">
        <JournalCard />
      </Cell>

      <Cell index={9}>
        <Link href="/help/notes/dashboard" className="v5-card v5-card-ghost w-full items-center justify-center gap-1.5 text-center">
          <span className="flex size-8 items-center justify-center rounded-full border border-[var(--v-line-strong)]">
            <Plus className="size-4" />
          </span>
          <span className="text-sm font-medium">Add card</span>
          <span className="text-xs text-[var(--v-faint)]">Make your own card</span>
        </Link>
      </Cell>
    </div>
  );
}

/** A Pomodoro that ticks a second at a time while it is on screen, and rests at 25:00. */
function PomodoroCard() {
  const { ref, frame } = useLoop(60, 1000, 0);
  const seconds = 25 * 60 - frame;
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div ref={ref} className="flex w-full">
      <Card title="Pomodoro" right={frame ? "Focus" : "Ready"} className="w-full">
        <div className="flex items-center gap-3">
          <Ring value={seconds / (25 * 60)} className="hidden [--size:3.75rem] sm:block" stroke={4} color={PALETTE.primary} />
          <div className="min-w-0 flex-1">
            <p className="text-[1.75rem] font-semibold tracking-[-0.04em] whitespace-nowrap tabular-nums">{label}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--v-soft)]">Launch brief</p>
            <span className="mt-2.5 block sm:hidden">
              <Meter value={seconds / (25 * 60)} color={PALETTE.primary} />
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** The journal card: today's line is typed in, then rests. */
function JournalCard() {
  const delays = Array.from({ length: JOURNAL.length + 1 }, (_, index) => (index === JOURNAL.length ? 4200 : index === 0 ? 1200 : 38));
  const { ref, frame, reduced } = useLoop(JOURNAL.length + 1, delays);
  const text = JOURNAL.slice(0, frame);
  return (
    <div ref={ref} className="flex w-full">
      <Card title="Journal" right="Today" className="w-full">
        <p className="min-h-[2.6em] text-sm leading-relaxed">
          {text}
          {reduced ? null : <span className="v5-caret" aria-hidden />}
        </p>
        <p className="v5-caption flex items-center gap-2">
          <span className="size-1.5 rounded-full" style={{ background: PALETTE.amber }} aria-hidden />
          Thu 15 Oct · 16:42 · saved
        </p>
      </Card>
    </div>
  );
}

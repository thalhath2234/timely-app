"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useInView, useScroll, useTransform } from "motion/react";
import { CalendarClock, Inbox, ListChecks, Timer, type LucideIcon } from "lucide-react";
import { cn } from "@/app/utils/cn";

type Step = {
  icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  image: string;
  alt: string;
  help: string;
};

const STEPS: Step[] = [
  {
    icon: Inbox,
    label: "Capture",
    title: "Get it out of your head.",
    body: "Type a thought into the Inbox or quick add the moment it shows up. No project, no date, no length yet. The phone's Quick Add drops into the same Inbox.",
    image: "/help/inbox.webp",
    alt: "The Inbox page with five captured thoughts waiting for review.",
    help: "/help/plan/inbox",
  },
  {
    icon: ListChecks,
    label: "Clarify",
    title: "Decide what each thing is.",
    body: "Turn an item into Work with a length and a space, or a Reminder with a time. Smart suggestions can fill in the project, labels and dates from the words you typed.",
    image: "/help/clarify.webp",
    alt: "The Clarify dialog turning an Inbox item into Work with a workspace, duration and deadline.",
    help: "/help/plan/inbox",
  },
  {
    icon: CalendarClock,
    label: "Auto-schedule",
    title: "Let the week arrange itself.",
    body: "Timely places Work inside your working hours and around your events, by deadline and priority. Preview the changes, apply them, and undo the last run if you change your mind.",
    image: "/help/calendar.webp",
    alt: "A week calendar filled with scheduled work blocks around events, with a waiting list on the right.",
    help: "/help/plan/auto-schedule",
  },
  {
    icon: Timer,
    label: "Focus",
    title: "Do the next thing.",
    body: "Today shows your focus list, habits and goals, and what is on the clock. Start a focus session and the time counts toward the task.",
    image: "/help/today.webp",
    alt: "The Today page with habits, goals and a Today focus list of three tasks.",
    help: "/help/plan/today",
  },
];

export default function LoopStory() {
  const [active, setActive] = useState(0);
  const select = useCallback((index: number) => setActive(index), []);
  const frameRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ["start end", "start 30%"] });
  const tilt = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);

  return (
    <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
      <ol className="relative">
        <span aria-hidden className="absolute top-2 bottom-2 left-[19px] hidden w-px bg-white/[0.08] lg:block" />
        {STEPS.map((step, index) => (
          <StepBlock key={step.label} step={step} index={index} active={active === index} onEnter={select} />
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-28" style={{ perspective: 1400 }}>
          <motion.div ref={frameRef} style={{ rotateX: tilt, scale }} className="origin-top">
            <ScreenFrame>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={active}
                  initial={{ opacity: 0, scale: 1.03, filter: "blur(6px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Image
                    src={STEPS[active].image}
                    alt={STEPS[active].alt}
                    width={1920}
                    height={1200}
                    sizes="(min-width: 1024px) 640px, 100vw"
                    className="block h-auto w-full"
                  />
                </motion.div>
              </AnimatePresence>
            </ScreenFrame>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function StepBlock({
  step,
  index,
  active,
  onEnter,
}: {
  step: Step;
  index: number;
  active: boolean;
  onEnter: (index: number) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => {
    if (inView) onEnter(index);
  }, [inView, onEnter, index]);

  const Icon = step.icon;
  return (
    <li ref={ref} className="relative pb-12 last:pb-0 lg:flex lg:min-h-[62vh] lg:items-center lg:pb-0">
      <div className="flex gap-5">
        <span
          className={cn(
            "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-500",
            active
              ? "border-[#c0c1ff]/50 bg-[#c0c1ff]/15 text-[#c0c1ff] shadow-[0_0_30px_-4px_rgba(192,193,255,0.6)]"
              : "border-white/10 bg-[var(--s-card)] text-white/45",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className={cn("transition-opacity duration-500 lg:opacity-40", active && "lg:opacity-100")}>
          <p className="text-sm font-semibold text-[var(--s-primary)]">
            {index + 1}. {step.label}
          </p>
          <h3 className="s-display mt-2 text-2xl font-semibold sm:text-3xl">{step.title}</h3>
          <p className="s-soft mt-3 max-w-md text-base leading-relaxed">{step.body}</p>
          <a href={step.help} className="mt-4 inline-block text-sm font-medium text-[var(--s-primary)] hover:underline">
            How {step.label.toLowerCase()} works →
          </a>
          <div className="mt-6 lg:hidden">
            <ScreenFrame>
              <Image src={step.image} alt={step.alt} width={1920} height={1200} sizes="100vw" className="block h-auto w-full" />
            </ScreenFrame>
          </div>
        </div>
      </div>
    </li>
  );
}

export function ScreenFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-[#111319] p-1.5 shadow-[0_30px_90px_-30px_rgba(129,131,244,0.5)]",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[11px] border border-white/[0.06]">{children}</div>
    </div>
  );
}

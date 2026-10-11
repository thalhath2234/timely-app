"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { spotlight } from "@/app/_components/site/motion";

/**
 * Lifts its children into place the first time they scroll into view. The
 * content is readable before that, so nothing waits on the observer.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
  onPointerMove,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section";
  onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      onPointerMove={onPointerMove}
      initial={{ opacity: 0.5, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

/** A Reveal whose border lights up under the pointer; put an `.s-spot-inner` box inside. */
export function SpotReveal({ children, className, delay }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <Reveal delay={delay} onPointerMove={spotlight} className={cn("s-spot p-px", className)}>
      {children}
    </Reveal>
  );
}

/** A feature on the landing page: a looping graphic over a title set like a calendar block. */
export function FeatureBlock({
  color,
  title,
  body,
  graphic,
  href,
  graphicClassName,
  delay = 0,
}: {
  color: string;
  title: string;
  body: string;
  graphic: ReactNode;
  href?: string;
  graphicClassName?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="flex min-w-0 flex-col">
      <div className={cn("relative h-52 rounded-xl border border-[var(--lp-line)] bg-[var(--lp-surface)] p-4", graphicClassName)}>
        {graphic}
      </div>
      <div className="lp-block mt-5 px-3.5 py-3" style={{ "--c": color } as React.CSSProperties}>
        <h3 className="text-lg font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--lp-soft)]">{body}</p>
      </div>
      {href ? (
        <a href={href} className="mt-3 text-sm font-medium text-[var(--lp-now)] hover:underline">
          How it works →
        </a>
      ) : null}
    </Reveal>
  );
}

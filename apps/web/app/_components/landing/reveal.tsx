"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { spotlight } from "@/app/_components/site/motion";

/** Fades and lifts its children in the first time they scroll into view. */
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
      initial={{ opacity: 0, y: 24 }}
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

/** A feature card: title and text over a looping graphic, with a border that follows the pointer. */
export function FeatureCard({
  eyebrow,
  title,
  body,
  graphic,
  href,
  className,
  graphicClassName,
  delay = 0,
}: {
  eyebrow: string;
  title: string;
  body: string;
  graphic: ReactNode;
  href?: string;
  className?: string;
  graphicClassName?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} onPointerMove={spotlight} className={cn("s-spot rounded-[22px] p-px", className)}>
      <div
        className="s-spot-inner flex flex-col overflow-hidden rounded-[21px] border border-white/[0.06] p-5 sm:p-6"
      >
        <div className={cn("relative min-h-44", graphicClassName)}>{graphic}</div>
        <div className="mt-6">
          <p className="text-xs font-semibold tracking-wide text-[var(--s-primary)] uppercase">{eyebrow}</p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
          <p className="s-soft mt-2 text-sm leading-relaxed">{body}</p>
          {href ? (
            <a href={href} className="mt-3 inline-block text-sm font-medium text-[var(--s-primary)] hover:underline">
              Learn more →
            </a>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}

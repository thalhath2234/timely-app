import type { CSSProperties, ReactNode } from "react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { Reveal } from "@/app/_components/landing/reveal";
import { cn } from "@/app/utils/cn";

/**
 * The building blocks of the conversation. A `Turn` is one section of the
 * page: the visitor's line on the right, then Timely's answer (one or more
 * bubbles and cards) grouped under the assistant's name.
 */

export function You({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex justify-end", className)}>
      <p className="v2-you">{children}</p>
    </div>
  );
}

export function Timely({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="v2-group-head">
        <span className="v2-avatar" aria-hidden>
          <TimelyLogo size={16} />
        </span>
        Timely
      </div>
      <div className="v2-group-body">{children}</div>
    </div>
  );
}

export function Bubble({
  children,
  className,
  style,
  tail = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** The first bubble of an answer gets the small corner that points at the avatar. */
  tail?: boolean;
  as?: "div" | "p";
}) {
  return (
    <Tag className={cn("v2-bubble", tail && "is-tail", className)} style={style}>
      {children}
    </Tag>
  );
}

export function Turn({
  id,
  you,
  children,
  className,
}: {
  id?: string;
  you: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("v2-turn", className)}>
      <Reveal>
        <You>{you}</You>
      </Reveal>
      <Reveal delay={0.08} className="mt-5 sm:mt-6">
        <Timely>{children}</Timely>
      </Reveal>
    </section>
  );
}

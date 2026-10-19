"use client";

import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { revealTransition } from "@/app/_components/_ui/motion";
import type { LoopId } from "@/app/_components/film/loops";
import { cn } from "@/app/utils/cn";

/** Loaded only when an empty state with a loop is on screen: Remotion stays out of every other page. */
const LoopPlayer = dynamic(() => import("@/app/_components/film/loopPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-[8/5] w-full bg-panel" />,
});

/**
 * Nothing here yet. With `loop`, a four-second film loop of the thing to do
 * plays beside one line of copy and the action (docs/design-system.md#empty-states);
 * without one, the centred dashed card.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  loop,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  loop?: LoopId;
  className?: string;
}) {
  if (loop) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={revealTransition}
        className={cn("flex flex-col gap-4 rounded-[12px] border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5", className)}
        data-testid="empty-state"
      >
        <div className="w-full shrink-0 overflow-hidden rounded-[10px] border border-border bg-panel sm:w-[320px] lg:w-[400px]">
          <LoopPlayer id={loop} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 px-1">
          {Icon ? <Icon className="mb-1 size-5 text-muted-foreground" /> : null}
          <p className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-foreground">{title}</p>
          {description ? <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
          {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={revealTransition}
      className={cn("flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center", className)}
      data-testid="empty-state"
    >
      {Icon ? <Icon className="size-7 text-muted-foreground" /> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </motion.div>
  );
}

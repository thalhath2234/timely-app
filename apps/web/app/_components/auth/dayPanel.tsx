"use client";

import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { clock, minuteOfDay, useNowMinute } from "./clock";

export type DayBlock = {
  id: string;
  title: string;
  /** Minutes from now; negative is earlier today. */
  at: number;
  /** Length in minutes. */
  length: number;
  /** Any CSS colour, usually a `--lp-*` project colour. */
  color: string;
  /** "now" outlines the block; "ghost" draws an empty dashed slot. Past is worked out from the time. */
  state?: "now" | "ghost";
  done?: boolean;
  tag?: { name: string; color: string };
  /** Start exactly at now + `at` instead of on the next quarter hour. */
  exact?: boolean;
};

const ease = [0.22, 1, 0.36, 1] as const;

/** Where a block starts: the "now" block at the real time, the rest from the next quarter hour, as people plan. */
function blockStart(block: DayBlock, now: number) {
  if (block.state === "now" || block.exact) return now + block.at;
  return Math.ceil((now + 1) / 15) * 15 + block.at;
}

function blockState(block: DayBlock) {
  if (block.state) return block.state;
  return block.at + block.length <= 0 ? "past" : undefined;
}

function BlockBody({
  block,
  start,
  compact,
}: {
  block: DayBlock;
  start: number;
  compact?: boolean;
}) {
  const range = `${clock(start)}–${clock(start + block.length)}`;
  const short = !compact && block.length < 35;
  return (
    <div
      className={cn(
        "flex h-full min-w-0 gap-x-2 px-2.5",
        short ? "items-center py-0.5" : "flex-col py-1.5",
      )}
    >
      <p
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--lp-ink)]",
          short && "order-2",
        )}
      >
        {block.done ? (
          <Check
            aria-label="Done"
            className="size-3.5 shrink-0 text-[var(--lp-green)]"
          />
        ) : null}
        <span className="truncate">{block.title}</span>
      </p>
      <p
        className={cn(
          "lp-mono shrink-0 text-[11px] text-[var(--lp-soft)]",
          short && "order-1",
        )}
      >
        {range}
      </p>
      {block.tag && (compact || block.length >= 75) ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--lp-soft)]">
          <span
            className="lp-dot"
            style={{ "--c": block.tag.color } as CSSProperties}
          />
          {block.tag.name}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A slice of today in Timely's day view: an hour gutter, a now marker at the
 * real time and the blocks it is given, placed relative to now. With
 * `compact` it is a short list for phones.
 */
export default function DayPanel({
  title = "Today",
  tabs,
  blocks,
  empty,
  compact = false,
  hours = 7,
  hourHeight = 64,
  hoursBefore = 2,
  className,
}: {
  title?: ReactNode;
  tabs?: string[];
  blocks: DayBlock[];
  empty?: ReactNode;
  compact?: boolean;
  hours?: number;
  hourHeight?: number;
  hoursBefore?: number;
  className?: string;
}) {
  const nowEpoch = useNowMinute();
  const now = nowEpoch === null ? null : minuteOfDay(nowEpoch);

  const header = (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--lp-line)] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--lp-ink)]">
          {title}
        </p>
      </div>
      {tabs && tabs.length > 0 ? (
        <ul
          aria-label="Workspaces"
          className="flex min-w-0 flex-wrap justify-end gap-1"
        >
          <AnimatePresence initial={false}>
            {tabs.map((tab, index) => (
              <motion.li
                key={tab}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, ease }}
                className={cn(
                  "max-w-[10rem] truncate rounded-md px-2 py-1 text-xs",
                  index === 0
                    ? "bg-[color-mix(in_oklch,var(--lp-now)_18%,transparent)] font-medium text-[var(--lp-ink)]"
                    : "border border-[var(--lp-line)] text-[var(--lp-soft)]",
                )}
              >
                {tab}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}
    </div>
  );

  if (compact) {
    const visible = blocks
      .filter((block) => block.state !== "ghost" && block.at + block.length > 0)
      .slice(0, 4);
    return (
      <section
        aria-label="Preview of your day"
        className={cn("lp-day", className)}
      >
        {header}
        <ul className="flex flex-col gap-1.5 p-2.5">
          {now !== null && visible.length === 0 && empty ? (
            <li className="px-1.5 py-2 text-sm text-[var(--lp-soft)]">
              {empty}
            </li>
          ) : null}
          <AnimatePresence initial={false}>
            {now !== null &&
              visible.map((block) => (
                <motion.li
                  key={block.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease }}
                  data-state={blockState(block)}
                  className="lp-day-block !relative"
                  style={{ "--c": block.color } as CSSProperties}
                >
                  <BlockBody
                    block={block}
                    start={blockStart(block, now)}
                    compact
                  />
                </motion.li>
              ))}
          </AnimatePresence>
        </ul>
      </section>
    );
  }

  const windowStart =
    now === null ? 0 : Math.floor(now / 60) * 60 - hoursBefore * 60;
  const height = hours * hourHeight;
  const toY = (minute: number) => ((minute - windowStart) / 60) * hourHeight;
  const nowY = now === null ? 0 : toY(now);
  // The empty hint shows until there is more than the "now" block.
  const hasBlocks = blocks.some(
    (block) => block.state !== "ghost" && block.state !== "now",
  );

  return (
    <section
      aria-label="Preview of your day"
      className={cn("lp-day overflow-hidden", className)}
    >
      {header}
      <div
        className="relative grid grid-cols-[56px_minmax(0,1fr)] overflow-hidden"
        style={{ height }}
      >
        {now !== null ? (
          <>
            <div aria-hidden className="relative">
              {Array.from({ length: hours }, (_, index) => {
                const y = index * hourHeight;
                if (index === 0 || Math.abs(y - nowY) < 14) return null;
                return (
                  <span
                    key={index}
                    className="lp-mono absolute right-2.5 -translate-y-1/2 text-[11px] text-[var(--lp-soft)]"
                    style={{ top: y }}
                  >
                    {clock(windowStart + index * 60)}
                  </span>
                );
              })}
            </div>
            <div
              className="lp-day-grid relative border-l border-[var(--lp-line)]"
              style={{ "--hour": `${hourHeight}px` } as CSSProperties}
            >
              <ul aria-label="Blocks">
                <AnimatePresence initial={false}>
                  {blocks.map((block) => {
                    const start = blockStart(block, now);
                    const top = toY(start);
                    const blockHeight = Math.max(
                      (block.length / 60) * hourHeight - 3,
                      22,
                    );
                    if (top + blockHeight < 0 || top > height) return null;
                    return (
                      <motion.li
                        key={block.id}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0, top, height: blockHeight }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        transition={{ duration: 0.45, ease }}
                        data-state={blockState(block)}
                        className="lp-day-block right-2.5 left-2"
                        style={
                          {
                            "--c": block.color,
                            top,
                            height: blockHeight,
                          } as CSSProperties
                        }
                      >
                        {block.state === "ghost" ? null : (
                          <BlockBody block={block} start={start} />
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
              {!hasBlocks && empty ? (
                <div
                  className="pointer-events-none absolute inset-x-6 flex justify-center"
                  style={{ top: nowY + 28 }}
                >
                  <p className="max-w-[30ch] text-center text-sm leading-relaxed text-[var(--lp-soft)]">
                    {empty}
                  </p>
                </div>
              ) : null}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: nowY - 9 }}
            >
              <span className="lp-mono ml-1.5 rounded-[5px] bg-[var(--lp-now)] px-1 py-0.5 text-[10.5px] font-semibold text-[var(--lp-now-ink)]">
                {clock(now)}
              </span>
              <span className="-ml-px size-2 rounded-full bg-[var(--lp-now)]" />
              <span className="h-px flex-1 bg-[var(--lp-now)]/70" />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

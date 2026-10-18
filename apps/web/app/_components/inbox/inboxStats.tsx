"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useDecisions } from "@/app/utils/hooks/decisions";
import { cn } from "@/app/utils/cn";

/**
 * The film's three stat tiles under the Inbox: how much is waiting and how
 * old it is, number beside label, and a slim pointer to smart suggestions
 * when they are off. They only summarise; Up next keeps the page's colour.
 */
export default function InboxStats({
  fresh,
  recent,
  stale,
  oldestDays,
}: {
  /** Captured today. */
  fresh: number;
  /** One or two days old. */
  recent: number;
  /** Old enough to count as stale. */
  stale: number;
  oldestDays: number;
}) {
  const decisions = useDecisions();
  const tiles = [
    { key: "fresh", value: fresh, label: "captured today", tone: "text-success" },
    { key: "recent", value: recent, label: "from this week", tone: "text-primary" },
    {
      key: "stale",
      value: stale,
      label: stale > 0 && oldestDays > 1 ? `getting stale, oldest ${oldestDays} days` : "getting stale",
      tone: stale > 0 ? "text-warning" : "text-muted-foreground",
    },
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="inbox-stats">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div key={tile.key} className="flex min-w-0 items-baseline gap-2.5 rounded-[12px] border border-border bg-card px-4 py-3">
            <span className={cn("text-2xl font-semibold tabular-nums tracking-[-0.02em]", tile.tone)}>{tile.value}</span>
            <span className="truncate text-[13px] text-muted-foreground">{tile.label}</span>
          </div>
        ))}
      </div>
      {decisions.data && !decisions.data.available ? (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          Smart suggestions are off, so Up next shows placeholders.{" "}
          <Link href="/settings?tab=agent" className="font-medium text-primary hover:underline">
            Turn on in Settings
          </Link>
        </p>
      ) : null}
    </div>
  );
}

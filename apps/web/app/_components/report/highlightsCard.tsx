"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Lightbulb, Sparkles } from "lucide-react";
import { highlightFacts, type DashboardData } from "@timely/contract/dashboard";
import type { HighlightGroup } from "@/app/utils/api/decisions";
import { useHighlights } from "@/app/utils/hooks/decisions";

/** Highlights (smart suggestions): what stands out this week, why Work is
 * blocked or left unfinished, and tips the person's own data backs. The
 * facts are counted here; smart suggestions only pick and sort them. */
export default function HighlightsCard({
  data,
  now,
  timeZone,
  loading,
  onOpenTask,
}: {
  data: DashboardData;
  now: Date;
  timeZone?: string;
  loading: boolean;
  onOpenTask: (id: string) => void;
}) {
  // Facts move by the hour at most, so the clock is read once per hour.
  const hour = Math.floor(now.getTime() / 3_600_000);
  const facts = useMemo(() => highlightFacts(data, { now: new Date(hour * 3_600_000), timeZone }), [data, hour, timeZone]);
  const query = useHighlights(facts, !loading);
  const result = query.data;

  if (loading || (query.isLoading && !result)) {
    return <p className="text-xs text-muted-foreground">Reading your week…</p>;
  }
  if (query.isError) {
    return <p className="text-xs text-muted-foreground">Highlights could not load.</p>;
  }
  if (!result?.available) {
    return (
      <p className="text-xs text-muted-foreground">
        Turn on smart suggestions in{" "}
        <Link href="/settings?tab=agent" className="underline underline-offset-2">
          Settings → Agent
        </Link>{" "}
        to see highlights.
      </p>
    );
  }
  const empty = !result.highlights.length && !result.blockers.length && !result.missed.length && !result.tips.length;
  if (empty) return <p className="text-xs text-muted-foreground">Nothing stands out this week.</p>;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 text-sm" data-testid="highlights-card">
      {result.highlights.length ? (
        <ul className="space-y-1.5">
          {result.highlights.map((fact) => (
            <li key={fact.id} className="flex gap-2">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span className="text-foreground">{fact.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Groups title="Why work is blocked" groups={result.blockers} onOpenTask={onOpenTask} />
      <Groups title="Why work was left unfinished" groups={result.missed} onOpenTask={onOpenTask} />
      {result.tips.length ? (
        <ul className="space-y-1.5 border-t border-border pt-2">
          {result.tips.map((tip) => (
            <li key={tip.key} className="flex gap-2 text-muted-foreground">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{tip.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Groups({ title, groups, onOpenTask }: { title: string; groups: HighlightGroup[]; onOpenTask: (id: string) => void }) {
  if (!groups.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {groups.slice(0, 3).map((group) => (
          <li key={group.key} className="text-xs">
            <span className="font-medium text-foreground">{group.label}</span>
            <span className="text-muted-foreground"> · {group.count}</span>
            <span className="text-muted-foreground">: </span>
            {group.tasks.slice(0, 3).map((task, i) => (
              <span key={task.id}>
                {i > 0 ? ", " : ""}
                <button type="button" onClick={() => onOpenTask(task.id)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {task.name}
                </button>
              </span>
            ))}
            {group.tasks.length > 3 ? <span className="text-muted-foreground"> and {group.tasks.length - 3} more</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

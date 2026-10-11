"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, FileText, FolderKanban, ListTodo, Minus, Sheet as SheetIcon } from "lucide-react";
import {
  computeCard,
  formatMetric,
  type CardQuery,
  type CardResult,
  type CardRow,
  type DashboardData,
  type EntityKind,
} from "@timely/contract/dashboard";
import { cn } from "@/app/utils/cn";
import { CategoryBars, ColumnChart, DonutChart, LineChart, Meter, seriesColor } from "./charts";

const ENTITY_ICON: Record<EntityKind, typeof ListTodo> = {
  task: ListTodo,
  project: FolderKanban,
  event: CalendarDays,
  doc: FileText,
  sheet: SheetIcon,
};

export function useCardResult(query: CardQuery | undefined, data: DashboardData, timeZone: string | undefined, now: Date) {
  return useMemo(() => (query ? computeCard(query, data, { now, timeZone }) : null), [query, data, timeZone, now]);
}

export default function CustomCardView({
  query,
  result,
  onOpen,
  onRowContextMenu,
  compact = false,
}: {
  query: CardQuery;
  result: CardResult;
  onOpen?: (row: CardRow) => void;
  onRowContextMenu?: (event: React.MouseEvent, row: CardRow) => void;
  /** Smaller type for the workshop preview at small sizes. */
  compact?: boolean;
}) {
  const color = query.color ?? 0;

  switch (result.kind) {
    case "number": {
      const delta = result.previous !== undefined ? result.value - result.previous : null;
      // "Up" is good unless the card counts something to drive down.
      const upIsGood = !(query.filters.overdue || (query.filters.state === "open" && query.source !== "events"));
      const tone = delta === null || delta === 0 ? "muted" : delta > 0 === upIsGood ? "good" : "bad";
      const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
      return (
        <div className="flex h-full flex-col justify-end">
          <div className="flex items-end gap-2">
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: seriesColor(color) }} aria-hidden />
            <span className={cn("font-semibold leading-none tabular-nums text-foreground", compact ? "text-3xl" : "text-4xl")}>
              {formatMetric(result.value, result.unit)}
            </span>
          </div>
          {delta !== null ? (
            <p
              className={cn(
                "mt-2 flex items-center gap-1 text-xs",
                tone === "good" && "text-success",
                tone === "bad" && "text-destructive",
                tone === "muted" && "text-muted-foreground",
              )}
            >
              <DeltaIcon className="size-3.5" />
              <span className="tabular-nums">
                {delta > 0 ? "+" : ""}
                {formatMetric(delta, result.unit)}
              </span>
              <span className="text-muted-foreground">{result.periodLabel}</span>
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {result.unit === "hours" ? `${result.matched} ${result.matched === 1 ? "item" : "items"}` : " "}
            </p>
          )}
        </div>
      );
    }
    case "progress": {
      const share = result.target > 0 ? result.value / result.target : 0;
      const done = share >= 1;
      return (
        <div className="flex h-full flex-col justify-end gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("font-semibold tabular-nums text-foreground", compact ? "text-2xl" : "text-3xl")}>{Math.round(share * 100)}%</span>
            <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
              {done ? <CheckCircle2 className="size-3.5 text-success" /> : null}
              {formatMetric(result.value, result.unit)} of {formatMetric(result.target, result.unit)}
              {query.progress === "goal" ? " goal" : " done"}
            </span>
          </div>
          <Meter value={share} color={color} />
        </div>
      );
    }
    case "list":
      if (result.rows.length === 0) return <Empty text="Nothing matches right now." />;
      return (
        <div className="flex h-full flex-col">
          <ul className="-mx-1 min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {result.rows.map((row) => {
              const Icon = ENTITY_ICON[row.entity];
              return (
                <li key={`${row.entity}-${row.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpen?.(row)}
                    onContextMenu={(event) => onRowContextMenu?.(event, row)}
                    className="flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/50"
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm text-foreground", row.done && "text-muted-foreground line-through")}>{row.title}</span>
                      {row.subtitle ? <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span> : null}
                    </span>
                    {row.meta ? (
                      <span className={cn("shrink-0 text-xs tabular-nums", row.tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
                        {row.meta}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {result.total > result.rows.length ? (
            <p className="pt-1.5 text-xs text-muted-foreground">
              {result.rows.length} of {result.total}
            </p>
          ) : null}
        </div>
      );
    case "series": {
      if (result.points.length === 0 || result.points.every((point) => point.value === 0)) {
        if (!result.temporal) return <Empty text="No data for these settings yet." />;
      }
      if (query.display === "pie") return <DonutChart points={result.points} unit={result.unit} total={result.total} />;
      if (query.display === "line") return <LineChart points={result.points} unit={result.unit} color={color} />;
      if (result.temporal || query.groupBy === "weekday") return <ColumnChart points={result.points} unit={result.unit} color={color} />;
      return <CategoryBars points={result.points} unit={result.unit} color={color} />;
    }
  }
}

function Empty({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">{text}</p>;
}

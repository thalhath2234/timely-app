"use client";

import type { CSSProperties } from "react";
import { Pause } from "lucide-react";
import {
  todayRows,
  type BotView,
  type BotsSummary,
  type TodayRow,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import { useSetAllPaused, useSetLink } from "@/app/utils/hooks/bots";

const say = (message: string) => useToastStore.getState().show(message);
const failed = (error: Error) => say(error.message);

/** `rows` split into `n` columns, top to bottom then left to right. */
function columnsOf<T>(rows: T[], n: number): T[][] {
  const per = Math.ceil(rows.length / n);
  return Array.from({ length: n }, (_, i) =>
    rows.slice(i * per, (i + 1) * per),
  ).filter((c) => c.length > 0);
}

const valueClass = "text-[13px] font-medium tabular-nums text-muted-foreground";

/**
 * The board's Today group: the Pause all bots switch, today's AI checks and
 * passed items, and a row for each switched-off pass with Turn on. Its rows
 * flow into `columns` inner columns when the card has the whole row to
 * itself, and the card fills its grid cell so it ends level with Chains.
 */
export function TodayGroup({
  summary,
  bots,
  columns,
  className,
  style,
}: {
  summary: BotsSummary;
  bots: BotView[];
  columns: number;
  className?: string;
  style?: CSSProperties;
}) {
  const pauseAll = useSetAllPaused();
  const setLink = useSetLink();
  const rows = todayRows(summary, bots);
  const cols = columnsOf(rows, Math.max(1, Math.min(columns, rows.length)));

  const onPause = (on: boolean) => {
    if (!on) {
      pauseAll.mutate(false, {
        onSuccess: () => say("Bots are on again"),
        onError: failed,
      });
      return;
    }
    requestConfirm({
      title: "Pause all bots?",
      description:
        "Nothing is checked, passed on or sent until you turn them on again.",
      confirmLabel: "Pause all",
      pendingLabel: "Pausing…",
      tone: "primary",
      icon: <Pause className="size-4" />,
      onConfirm: async () => {
        try {
          await pauseAll.mutateAsync(true);
        } catch (error) {
          failed(error as Error);
        }
      },
    });
  };

  const row = (r: TodayRow) => {
    if (r.kind === "switch")
      return (
        <ListRow key={r.id} label={r.label}>
          <ListSwitch
            label={r.label}
            checked={r.on}
            disabled={pauseAll.isPending}
            onChange={onPause}
          />
        </ListRow>
      );
    if (r.kind === "link")
      return (
        <ListRow key={r.id} label={r.label}>
          <span className={valueClass}>{r.value}</span>
          <Button
            variant="outline"
            size="sm"
            loading={setLink.isPending && setLink.variables?.linkId === r.id}
            onClick={() =>
              setLink.mutate(
                { linkId: r.id, enabled: true },
                { onError: failed },
              )
            }
          >
            {r.action}
          </Button>
        </ListRow>
      );
    return (
      <ListRow key={r.id} label={r.label}>
        <span className={valueClass}>{r.value}</span>
      </ListRow>
    );
  };

  return (
    <section
      aria-label="Today"
      className={cn("flex min-w-0 flex-col", className)}
      style={style}
    >
      <GroupLabel>Today</GroupLabel>
      {cols.length === 1 ? (
        <ListGroup className="flex-1">{cols[0].map(row)}</ListGroup>
      ) : (
        <div
          className="grid flex-1 overflow-hidden rounded-[12px] border border-border bg-card"
          style={{
            gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`,
          }}
        >
          {cols.map((c, index) => (
            <ListGroup
              key={index}
              className={cn(
                "rounded-none border-0 bg-transparent",
                index > 0 && "border-l",
              )}
            >
              {c.map(row)}
            </ListGroup>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import type { ReactNode } from "react";
import {
  defaultMinutes,
  floorHint,
  intervalLabel,
  intervalOptions,
  type WatchInput,
} from "@timely/contract/bots";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  rowValueClass,
} from "@/app/_components/_ui/groupedList";
import { PageBadge } from "@/app/_components/_ui/pageHeader";
import Select from "@/app/_components/_ui/select";
import { cn } from "@/app/utils/cn";

/**
 * Schedule: Checks every (from the bot's floor up to a week) and Only
 * during, which arrives later. The hint says why the floor is what it is.
 */
export function ScheduleGroup({
  watches,
  intervalMinutes,
  onChange,
  error,
}: {
  watches: WatchInput[];
  intervalMinutes: number;
  onChange: (minutes: number) => void;
  error?: ReactNode;
}) {
  const current = intervalMinutes || defaultMinutes(watches);
  const options = intervalOptions(watches, current).map((m) => ({
    value: String(m),
    label: intervalLabel(m),
  }));
  return (
    <section>
      <GroupLabel>Schedule</GroupLabel>
      <ListGroup>
        <ListRow label="Checks every">
          <Select
            variant="row"
            aria-label="Checks every"
            value={String(current)}
            options={options}
            onChange={(v) => onChange(Number(v))}
          />
        </ListRow>
        <ListRow label="Only during" className="opacity-50">
          <PageBadge>Later</PageBadge>
          <span
            className={cn(
              rowValueClass,
              "cursor-default hover:bg-transparent hover:text-muted-foreground",
            )}
          >
            Always
          </span>
        </ListRow>
      </ListGroup>
      {error ? (
        <GroupHint className="text-destructive">{error}</GroupHint>
      ) : null}
      {watches.length ? <GroupHint>{floorHint(watches)}</GroupHint> : null}
    </section>
  );
}

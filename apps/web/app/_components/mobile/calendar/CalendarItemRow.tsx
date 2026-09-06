"use client";

import { CalendarClock, Check, ListTodo, Repeat } from "lucide-react";
import type { CalendarItem } from "@/app/_types/types";
import { formatTimeRange } from "@/app/_lib/mobile/format";

export function itemColor(item: CalendarItem) {
  return item.color ?? item.task?.project?.color ?? "var(--primary)";
}

export function isTaskItem(item: CalendarItem) {
  return item.kind === "task" || item.kind === "taskOccurrence";
}

export default function CalendarItemRow({
  item,
  onOpen,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
}) {
  const done = Boolean(item.completedAt);
  const recurring = item.kind.endsWith("Occurrence") || Boolean(item.seriesId);
  const Icon = isTaskItem(item) ? ListTodo : CalendarClock;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex min-h-14 w-full items-stretch gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors active:bg-muted"
    >
      <span
        className="w-1 shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: itemColor(item) }}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[15px] font-medium leading-5 ${
            done ? "text-muted-foreground line-through" : "text-card-foreground"
          }`}
        >
          {item.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon size={12} />
          {item.allDay ? "All day" : formatTimeRange(item.start, item.end)}
          {item.chunkCount > 1 ? ` · part ${item.chunkIndex + 1}/${item.chunkCount}` : ""}
          {recurring ? <Repeat size={12} /> : null}
        </p>
      </div>
      {done ? (
        <span className="flex items-center text-primary">
          <Check size={16} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

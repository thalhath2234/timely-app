"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { Task, TaskListDataMode } from "@/app/_types/types";
import { toDateInputValue } from "@/app/utils/calendar";
import { resolvedColor } from "@/app/utils/entityColor";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { dragHasTask, readTaskDragId, setTaskDragData } from "@/app/utils/taskDrag";
import { taskTimelineSpan } from "@/app/utils/taskDates";

type GanttViewProps = {
  rows: Task[];
  dataMode: TaskListDataMode;
  onSelectRow: (row: Task) => void;
};

function formatDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function parseDateValue(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Project rows are synthesised from tasks and only carry start / deadline. */
function projectSpan(row: Task): { start: Date; end: Date } | null {
  const start = parseDateValue(row.startDate);
  const end = parseDateValue(row.deadline) ?? parseDateValue(row.completedAt);
  if (!start && !end) return null;
  const resolvedStart = start ?? end!;
  const resolvedEnd = end ?? start!;
  return { start: resolvedStart, end: resolvedEnd < resolvedStart ? resolvedStart : resolvedEnd };
}

function dateAtClientX(clientX: number, target: HTMLElement, min: Date, totalDurationMs: number) {
  const rect = target.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / width));
  return new Date(min.getTime() + ratio * totalDurationMs);
}

/** Displays task or project rows on an interactive time-scaled Gantt chart. */
export default function GanttView({ rows, dataMode, onSelectRow }: GanttViewProps) {
  const updateTask = useUpdateTask();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const timelineRows = useMemo(() => {
    const dated: { row: Task; start: Date; end: Date }[] = [];
    const undated: Task[] = [];

    rows.forEach((row) => {
      // Project rows are synthesised and only carry start/deadline; tasks use
      // the shared date model (start, blocks, deadline) and never fall back to
      // created/updated timestamps, which drew misleading historical bars.
      const span = dataMode === "project" ? projectSpan(row) : taskTimelineSpan(row);
      if (span) {
        dated.push({ row, start: span.start, end: span.end });
      } else {
        undated.push(row);
      }
    });

    if (dated.length === 0) {
      const today = new Date();
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      return { entries: [], undated, min: today, max: tomorrow };
    }

    const min = new Date(Math.min(...dated.map((entry) => entry.start.getTime())));
    const max = new Date(Math.max(...dated.map((entry) => entry.end.getTime())));

    dated.sort((a, b) => a.start.getTime() - b.start.getTime());

    return { entries: dated, undated, min, max };
  }, [rows, dataMode]);

  const totalDurationMs = Math.max(
    24 * 60 * 60 * 1000,
    timelineRows.max.getTime() - timelineRows.min.getTime(),
  );

  const placeOnTimeline = (taskId: string, at: Date) => {
    if (dataMode !== "task") return;
    const task = rows.find((row) => row.id === taskId);
    if (!task) return;
    const start = toDateInputValue(at);
    const end = new Date(at);
    if ((task.duration ?? 0) > 0) {
      end.setMinutes(end.getMinutes() + task.duration);
    } else {
      end.setDate(end.getDate() + 1);
    }
    void updateTask.mutateAsync({
      id: taskId,
      startDate: start,
      deadline: toDateInputValue(end),
    });
  };

  const onTimelineDragOver = (event: DragEvent<HTMLElement>) => {
    if (dataMode !== "task" || !dragHasTask(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onTimelineDrop = (event: DragEvent<HTMLElement>) => {
    if (dataMode !== "task") return;
    event.preventDefault();
    const id = readTaskDragId(event) || draggingId || "";
    setDraggingId(null);
    if (!id) return;
    placeOnTimeline(id, dateAtClientX(event.clientX, event.currentTarget, timelineRows.min, totalDurationMs));
  };

  if (timelineRows.entries.length === 0 && timelineRows.undated.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No items found for Gantt view.</div>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="min-w-245 rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[320px_1fr] border-b border-border bg-muted/40">
          <div className="px-3 py-2 text-xs text-muted-foreground uppercase tracking-wide">{dataMode}</div>
          <div
            className="px-3 py-2 text-xs text-muted-foreground uppercase tracking-wide"
            onDragOver={onTimelineDragOver}
            onDrop={onTimelineDrop}
          >
            {timelineRows.entries.length > 0
              ? `${formatDateLabel(timelineRows.min.toISOString())} - ${formatDateLabel(timelineRows.max.toISOString())}`
              : "Drop a task here to set dates"}
          </div>
        </div>

        {timelineRows.entries.map(({ row, start, end }) => {
          const startOffset = start.getTime() - timelineRows.min.getTime();
          const endOffset = end.getTime() - timelineRows.min.getTime();
          const left = (startOffset / totalDurationMs) * 100;
          const width = Math.max(2, ((endOffset - startOffset) / totalDurationMs) * 100);
          const barColor = resolvedColor(
            row.project?.color || row.workspace?.color,
            row.project?.id || row.workspace?.id,
          );

          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectRow(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectRow(row);
                }
              }}
              className="grid cursor-pointer grid-cols-[320px_1fr] border-b border-border transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <div className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: barColor }}
                  />
                  <div className="truncate text-sm text-foreground">{row.name}</div>
                </div>
                <div className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {row.workspace?.color ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.workspace.color }}
                    />
                  ) : null}
                  {row.workspace?.name || "No workspace"}
                </div>
              </div>

              <div
                className="px-3 py-3"
                onDragOver={onTimelineDragOver}
                onDrop={(event) => {
                  event.stopPropagation();
                  onTimelineDrop(event);
                }}
              >
                <div className="relative h-8 rounded-md border border-border bg-muted">
                  <div
                    className="absolute top-1/2 h-4 -translate-y-1/2 rounded-md"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>

                <div className="mt-1 text-[11px] text-muted-foreground">
                  {formatDateLabel(start.toISOString())} - {formatDateLabel(end.toISOString())}
                </div>
              </div>
            </div>
          );
        })}

        {timelineRows.undated.length > 0 && (
          <div className="border-t border-border bg-muted/20">
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {timelineRows.undated.length} without dates — drag onto the timeline to set a start
              and deadline, or open a row to edit dates.
            </div>
            <ul className="divide-y divide-border">
              {timelineRows.undated.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    draggable={dataMode === "task"}
                    onDragStart={(event) => {
                      setDraggingId(row.id);
                      setTaskDragData(event, row.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onSelectRow(row)}
                    className="flex w-full cursor-grab items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 active:cursor-grabbing"
                  >
                    <span className="truncate text-foreground">{row.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.workspace?.name || "No workspace"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, Play, Plus, Square, Star } from "lucide-react";
import type { Task } from "@/app/_types/types";
import { dateOnly, localDateStamp } from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import {
  useAddChecklistItem,
  useDeleteChecklistItem,
  useDuplicateTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useToggleChecklistItem,
} from "@/app/utils/hooks/tasks";
import { showUndoToast } from "@/app/_store/toastStore";
import { GroupHint, GroupLabel, ListGroup } from "@/app/_components/_ui/groupedList";
import { isReminderTask } from "@/app/utils/taskFilters";

function todayStamp() {
  return localDateStamp();
}

const actionClass =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors";

export default function TaskExecution({
  task,
  compact,
}: {
  task: Task;
  compact?: boolean;
}) {
  const addItem = useAddChecklistItem(task.id);
  const toggleItem = useToggleChecklistItem(task.id);
  const removeItem = useDeleteChecklistItem(task.id);
  const duplicate = useDuplicateTask();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const [checkTitle, setCheckTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const focusing = Boolean(task.focusStartedAt);
  // Finished work and reminders have nothing left to focus on.
  const focusable = !task.completedAt && !isReminderTask(task);
  const onToday = dateOnly(task.todayFocusOn) === todayStamp();
  const checklist = useMemo(
    () => [...(task.checklist ?? [])].sort((a, b) => a.order - b.order),
    [task.checklist],
  );
  const doneCount = checklist.filter((item) => item.completedAt).length;
  const totalCount = checklist.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {focusing ? (
          <button
            type="button"
            onClick={() => void stopFocus.mutateAsync(task.id)}
            className={cn(actionClass, "border-primary bg-primary text-primary-foreground")}
          >
            <Square className="size-3.5" /> Stop focus
          </button>
        ) : focusable ? (
          <button
            type="button"
            onClick={() => void startFocus.mutateAsync(task.id)}
            className={cn(
              actionClass,
              "border-primary/40 bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground",
            )}
          >
            <Play className="size-3.5" />
            Focus Now
          </button>
        ) : null}
        {focusable || onToday ? (
          <button
            type="button"
            onClick={() => void setFocus.mutateAsync({ taskId: task.id, date: onToday ? null : todayStamp() })}
            className={cn(
              actionClass,
              onToday
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-foreground hover:border-border",
            )}
          >
            <Star className={cn("size-3.5", onToday ? "fill-current text-warning" : "text-warning")} />
            {onToday ? "In Today" : "Today Focus"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            void duplicate.mutateAsync(task.id).then((copy) => {
              showUndoToast(`Duplicated “${copy.name}”`);
            })
          }
          className={cn(actionClass, "border-border bg-muted/40 text-foreground hover:border-border")}
        >
          <Copy className="size-3.5" /> Duplicate
        </button>
        {(task.actualMinutes ?? 0) > 0 ? (
          <span className="text-xs text-muted-foreground">{task.actualMinutes}m focused</span>
        ) : null}
      </div>

      {!compact ? (
        <section>
          <GroupLabel aside={totalCount > 0 ? `${doneCount} of ${totalCount} done` : undefined}>Checklist</GroupLabel>
          <ListGroup>
            {checklist.map((item) => (
              <div key={item.id} className="group flex min-h-10 items-center gap-2.5 px-3.5">
                <button
                  type="button"
                  onClick={() =>
                    void toggleItem.mutateAsync({
                      itemId: item.id,
                      completed: !item.completedAt,
                    })
                  }
                  className="cursor-pointer text-muted-foreground"
                  aria-label={item.completedAt ? "Reopen" : "Complete"}
                >
                  {item.completedAt ? (
                    <span className="flex size-4 items-center justify-center rounded border border-success/40 bg-success/20 text-success">
                      <Check className="size-3" />
                    </span>
                  ) : (
                    <span className="block size-4 rounded border border-border" />
                  )}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px]",
                    item.completedAt ? "text-muted-foreground line-through" : "font-medium text-foreground",
                  )}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void removeItem.mutateAsync(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            <form
              className="flex min-h-10 items-center gap-2.5 px-3.5"
              onSubmit={(event) => {
                event.preventDefault();
                const title = checkTitle.trim();
                if (!title || submittingRef.current) return;
                submittingRef.current = true;
                void addItem
                  .mutateAsync(title)
                  .then(() => setCheckTitle(""))
                  .catch(() => {
                    // addItem.isError already renders the failure.
                  })
                  .finally(() => {
                    submittingRef.current = false;
                  });
              }}
            >
              <Plus className="size-4 shrink-0 text-primary" />
              <input
                ref={addInputRef}
                value={checkTitle}
                onChange={(event) => setCheckTitle(event.target.value)}
                aria-label="New checklist item"
                placeholder="Add an item"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-primary"
              />
              {checkTitle.trim() ? (
                <button type="submit" className="cursor-pointer text-[13px] font-medium text-primary">
                  Add
                </button>
              ) : null}
            </form>
          </ListGroup>
          {addItem.isError ? (
            <GroupHint className="text-destructive">
              {addItem.error instanceof Error
                ? addItem.error.message
                : "Could not add checklist item."}
            </GroupHint>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

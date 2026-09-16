"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, ListTodo, Play, Plus, Square, Star } from "lucide-react";
import type { Task } from "@/app/_types/types";
import { dateOnly, localDateStamp } from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import {
  useAddChecklistItem,
  useCreateTask,
  useDeleteChecklistItem,
  useDuplicateTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useToggleChecklistItem,
} from "@/app/utils/hooks/tasks";
import { showUndoToast } from "@/app/_store/toastStore";
import { isInboxTask, isReminderTask } from "@/app/utils/taskFilters";

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
  const createSubtask = useCreateTask();
  const duplicate = useDuplicateTask();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const setFocus = useSetTodayFocus();
  const [checkTitle, setCheckTitle] = useState("");
  const [composeSubtask, setComposeSubtask] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const canAddSubtask = !task.parentTaskId && !compact && !isInboxTask(task) && !isReminderTask(task);
  const focusing = Boolean(task.focusStartedAt);
  const onToday = dateOnly(task.todayFocusOn) === todayStamp();
  const checklist = useMemo(
    () => [...(task.checklist ?? [])].sort((a, b) => a.order - b.order),
    [task.checklist],
  );
  const subtasks = task.subtasks ?? [];
  const doneCount =
    checklist.filter((item) => item.completedAt).length +
    subtasks.filter((child) => child.completedAt).length;
  const totalCount = checklist.length + subtasks.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  useEffect(() => {
    if (!composeSubtask) return;
    addInputRef.current?.focus();
  }, [composeSubtask]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      }
      event.preventDefault();
      if (focusing) {
        void stopFocus.mutateAsync(task.id);
        return;
      }
      void startFocus.mutateAsync(task.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusing, startFocus, stopFocus, task.id]);

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
        ) : (
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
            <kbd className="ml-0.5 rounded bg-primary/20 px-1 font-mono text-[10px] opacity-80">
              ⌘F
            </kbd>
          </button>
        )}
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
        {canAddSubtask ? (
          <button
            type="button"
            onClick={() => {
              setComposeSubtask(true);
              addInputRef.current?.focus();
            }}
            className={cn(
              actionClass,
              "border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Plus className="size-3.5" /> Add Subtask
          </button>
        ) : null}
        {(task.actualMinutes ?? 0) > 0 ? (
          <span className="text-xs text-muted-foreground">{task.actualMinutes}m focused</span>
        ) : null}
      </div>

      {!compact ? (
        <section className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subtasks &amp; Validation
              </h3>
              {totalCount > 0 ? (
                <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 font-mono text-[11px] font-medium text-success">
                  {doneCount} of {totalCount} done
                </span>
              ) : null}
            </div>
            {totalCount > 0 ? (
              <span className="font-mono text-xs text-muted-foreground">{progressPct}%</span>
            ) : null}
          </div>
          {totalCount > 0 ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-success to-primary"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}

          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2.5 hover:bg-muted/40"
              >
                <button
                  type="button"
                  onClick={() =>
                    void toggleItem.mutateAsync({
                      itemId: item.id,
                      completed: !item.completedAt,
                    })
                  }
                  className="text-muted-foreground"
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
                    "min-w-0 flex-1 text-xs",
                    item.completedAt ? "text-muted-foreground line-through" : "font-medium text-foreground",
                  )}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void removeItem.mutateAsync(item.id)}
                >
                  Remove
                </button>
              </li>
            ))}
            {subtasks.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/tasks?taskId=${encodeURIComponent(child.id)}`}
                  className="group flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2.5 hover:bg-muted/40"
                >
                  {child.completedAt ? (
                    <span className="flex size-4 items-center justify-center rounded border border-success/40 bg-success/20 text-success">
                      <Check className="size-3" />
                    </span>
                  ) : (
                    <ListTodo className="size-4 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-xs",
                      child.completedAt ? "text-muted-foreground line-through" : "font-medium text-foreground",
                    )}
                  >
                    {child.name}
                  </span>
                  {child.status?.name ? (
                    <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {child.status.name}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <form
            className="flex items-center gap-2 px-1 text-muted-foreground"
            onSubmit={(event) => {
              event.preventDefault();
              const title = checkTitle.trim();
              if (!title || submittingRef.current) return;
              submittingRef.current = true;
              const done = () => {
                submittingRef.current = false;
              };
              if (composeSubtask && canAddSubtask) {
                const workspaceId = task.workspaceId || task.workspace?.id || undefined;
                void createSubtask
                  .mutateAsync({
                    name: title,
                    parentTaskId: task.id,
                    duration: task.duration > 0 ? task.duration : 30,
                    kind: "task",
                    workspaceId,
                    projectId: task.projectId || task.project?.id || undefined,
                    statusId: task.statusId || task.status?.id || undefined,
                    stageId: task.stageId || task.stage?.id || undefined,
                    priorityLevel: task.priorityLevel || undefined,
                  })
                  .then(() => {
                    setCheckTitle("");
                  })
                  .finally(done);
                return;
              }
              void addItem.mutateAsync(title).then(() => setCheckTitle("")).finally(done);
            }}
          >
            <Plus className="size-3.5 shrink-0" />
            <input
              ref={addInputRef}
              value={checkTitle}
              onChange={(event) => setCheckTitle(event.target.value)}
              placeholder={
                composeSubtask
                  ? "Add subtask... (Press Enter)"
                  : "Add subtask or checklist item... (Press Enter)"
              }
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </form>
          {createSubtask.isError ? (
            <p className="px-1 text-xs text-destructive">
              {createSubtask.error instanceof Error
                ? createSubtask.error.message
                : "Could not add subtask."}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

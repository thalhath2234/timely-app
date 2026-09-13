"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Circle, Copy, ListTodo, Play, Square, Star } from "lucide-react";
import type { Task } from "@/app/_types/types";
import { dateOnly, localDateStamp } from "@/app/utils/calendar";
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

function todayStamp() {
  return localDateStamp();
}

function progressLabel(task: Task) {
  const done = task.progressDone ?? 0;
  const total = task.progressTotal ?? 0;
  if (total === 0) return null;
  return `${done}/${total}`;
}

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
  const [subtaskTitle, setSubtaskTitle] = useState("");

  const focusing = Boolean(task.focusStartedAt);
  const onToday = dateOnly(task.todayFocusOn) === todayStamp();
  const checklist = useMemo(
    () => [...(task.checklist ?? [])].sort((a, b) => a.order - b.order),
    [task.checklist],
  );
  const subtasks = task.subtasks ?? [];

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {focusing ? (
          <button
            type="button"
            onClick={() => void stopFocus.mutateAsync(task.id)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
          >
            <Square className="size-3.5" /> Stop focus
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startFocus.mutateAsync(task.id)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs"
          >
            <Play className="size-3.5" /> Focus
          </button>
        )}
        <button
          type="button"
          onClick={() => void setFocus.mutateAsync({ taskId: task.id, date: onToday ? null : todayStamp() })}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${onToday ? "border-primary text-primary" : "border-border"}`}
        >
          <Star className="size-3.5" /> {onToday ? "In Today" : "Today"}
        </button>
        <button
          type="button"
          onClick={() =>
            void duplicate.mutateAsync(task.id).then((copy) => {
              showUndoToast(`Duplicated “${copy.name}”`);
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs"
        >
          <Copy className="size-3.5" /> Duplicate
        </button>
        {progressLabel(task) ? (
          <span className="text-xs text-muted-foreground">Progress {progressLabel(task)}</span>
        ) : null}
        {(task.actualMinutes ?? 0) > 0 ? (
          <span className="text-xs text-muted-foreground">{task.actualMinutes}m focused</span>
        ) : null}
      </div>

      {!compact ? (
        <>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Checklist
            </h3>
            <ul className="space-y-1">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
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
                    {item.completedAt ? <Check className="size-4 text-primary" /> : <Circle className="size-4" />}
                  </button>
                  <span className={item.completedAt ? "text-muted-foreground line-through" : ""}>
                    {item.title}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => void removeItem.mutateAsync(item.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const title = checkTitle.trim();
                if (!title) return;
                void addItem.mutateAsync(title).then(() => setCheckTitle(""));
              }}
            >
              <input
                value={checkTitle}
                onChange={(event) => setCheckTitle(event.target.value)}
                placeholder="Add checklist item"
                className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none"
              />
            </form>
          </section>

          {!task.parentTaskId ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subtasks {task.openSubtaskCount ? `(${task.openSubtaskCount} open)` : ""}
              </h3>
              <ul className="space-y-1">
                {subtasks.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/tasks?taskId=${encodeURIComponent(child.id)}`}
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/40"
                    >
                      <ListTodo className="size-3.5 text-muted-foreground" />
                      <span className={child.completedAt ? "line-through text-muted-foreground" : ""}>
                        {child.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = subtaskTitle.trim();
                  if (!name) return;
                  void createSubtask
                    .mutateAsync({
                      name,
                      parentTaskId: task.id,
                      duration: 30,
                      workspaceId: task.workspaceId ?? undefined,
                    })
                    .then(() => setSubtaskTitle(""));
                }}
              >
                <input
                  value={subtaskTitle}
                  onChange={(event) => setSubtaskTitle(event.target.value)}
                  placeholder="Add subtask"
                  className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none"
                />
              </form>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

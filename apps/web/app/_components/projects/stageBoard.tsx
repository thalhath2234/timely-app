"use client";

import { useMemo, useState } from "react";
import { Check, Circle, Plus } from "lucide-react";
import ColorChip from "@/app/_components/_ui/colorChip";
import type { Stage, Task } from "@/app/_types/types";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { showUndoToast } from "@/app/_store/toastStore";
import { chipStyle, laneStyle, resolvedColor, UNSTAGED_COLOR } from "@/app/utils/entityColor";
import { isCompletedStatus } from "@/app/utils/status";
import { priorityColor } from "@/app/utils/priority";
import { sortedStages, stageCode } from "@/app/utils/stages";

/** Displays project tasks in color-coded stage lanes with drag-and-drop updates. */
export default function StageBoard({
  projectId,
  workspaceId,
  stages,
  tasks,
}: {
  projectId: string;
  workspaceId?: string;
  stages?: Stage[] | null;
  tasks: Task[];
}) {
  const openTask = useEntityDetailStore((state) => state.openTask);
  const updateTask = useUpdateTask();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const ordered = sortedStages(stages);

  const columns = useMemo(() => {
    const byStage = new Map<string, Task[]>();
    const unstaged: Task[] = [];
    for (const task of tasks) {
      if (task.stageId && ordered.some((stage) => stage.id === task.stageId)) {
        const existing = byStage.get(task.stageId) ?? [];
        existing.push(task);
        byStage.set(task.stageId, existing);
      } else {
        unstaged.push(task);
      }
    }
    return [
      {
        id: "",
        name: "Unstaged",
        code: "",
        color: UNSTAGED_COLOR,
        items: unstaged,
      },
      ...ordered.map((stage, index) => ({
        id: stage.id,
        name: stage.name,
        code: stageCode(stage.name, index),
        color: resolvedColor(stage.color, undefined, index),
        items: byStage.get(stage.id) ?? [],
      })),
    ];
  }, [ordered, tasks]);

  const activeStageId = useMemo(() => {
    for (const column of columns) {
      if (!column.id) continue;
      const total = column.items.length;
      const done = column.items.filter((task) => task.completedAt).length;
      if (total === 0 || done < total) return column.id;
    }
    return columns.find((column) => column.id)?.id ?? "";
  }, [columns]);

  /** Opens task creation with this project and optional stage preselected. */
  const addTask = (stageId?: string) => {
    setCreateTaskDraft({
      workspaceId,
      projectId,
      stageId,
    });
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  const moveTask = async (task: Task, stageId: string) => {
    const previous = task.stageId ?? "";
    const next = stageId || "";
    if (previous === next) return;
    try {
      await updateTask.mutateAsync({ id: task.id, stageId: next });
      showUndoToast(`Moved to ${next ? columns.find((column) => column.id === next)?.name : "Unstaged"}`, () => {
        void updateTask.mutateAsync({ id: task.id, stageId: previous });
      });
    } catch {
      showUndoToast("Could not move task");
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Board by stages
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="text-success">●</span> {columns.length} lanes active
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Scroll horizontally to view future sprints</p>
      </div>
      <div className="overflow-auto">
        <div className="flex min-w-max gap-3 p-1">
          {columns.map((column) => {
            const active = column.id !== "" && column.id === activeStageId;
            return (
              <section
                key={column.id || "unstaged"}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const task = tasks.find((item) => item.id === draggingId);
                  if (task) void moveTask(task, column.id);
                  setDraggingId(null);
                }}
                className="w-72 shrink-0 rounded-xl border bg-muted/30"
                style={laneStyle(column.color)}
              >
                <header className="flex items-center justify-between gap-2 px-3 py-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: column.color }}
                    />
                    <span className="truncate">
                      {column.code &&
                      !column.name.toUpperCase().startsWith(column.code)
                        ? `${column.code} — ${column.name}`
                        : column.name}
                    </span>
                    <span
                      className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold"
                      style={chipStyle(column.color)}
                    >
                      {column.items.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    title={`Add task to ${column.name}`}
                    onClick={() => addTask(column.id || undefined)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </header>
                {active ? (
                  <div
                    className="mx-3 mb-2 h-0.5 rounded-full"
                    style={{ backgroundColor: column.color }}
                  />
                ) : null}
                <div className="min-h-24 space-y-2 p-2 pt-0">
                  {column.items.map((task) => {
                    const done = Boolean(task.completedAt) || isCompletedStatus(task.status);
                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={() => setDraggingId(task.id)}
                        onClick={() => openTask(task.id)}
                        className="cursor-pointer rounded-lg border border-border bg-card p-3 text-sm shadow-xs hover:border-primary/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {done ? (
                              <Check className="size-3.5 shrink-0 text-success" />
                            ) : (
                              <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {task.id.slice(0, 8)}
                            </span>
                          </div>
                          {task.status?.name ? (
                            <ColorChip color={task.status.color} dot={false}>
                              {task.status.name}
                            </ColorChip>
                          ) : null}
                        </div>
                        <div className="mt-1.5 font-medium text-foreground">{task.name}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {task.priorityLevel ? (
                            <ColorChip color={priorityColor(task.priorityLevel)} dot={false}>
                              {task.priorityLevel}
                            </ColorChip>
                          ) : null}
                          {(task.labels ?? []).map((label) => (
                            <ColorChip key={label.id} color={label.color} dot={false}>
                              {label.name}
                            </ColorChip>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className="sr-only">Project {projectId}</p>
    </section>
  );
}

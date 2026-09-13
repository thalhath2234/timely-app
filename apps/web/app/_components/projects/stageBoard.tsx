"use client";

import { useMemo, useState } from "react";
import type { Stage, Task } from "@/app/_types/types";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { showUndoToast } from "@/app/_store/toastStore";
import { sortedStages } from "@/app/utils/stages";

export default function StageBoard({
  projectId,
  stages,
  tasks,
}: {
  projectId: string;
  stages?: Stage[] | null;
  tasks: Task[];
}) {
  const openTask = useEntityDetailStore((state) => state.openTask);
  const updateTask = useUpdateTask();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const columns = useMemo(() => {
    const ordered = sortedStages(stages);
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
      { id: "", name: "Unstaged", items: unstaged },
      ...ordered.map((stage) => ({
        id: stage.id,
        name: stage.name,
        items: byStage.get(stage.id) ?? [],
      })),
    ];
  }, [stages, tasks]);

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
    <div className="overflow-auto">
      <div className="flex min-w-max gap-3 p-1">
        {columns.map((column) => (
          <section
            key={column.id || "unstaged"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const task = tasks.find((item) => item.id === draggingId);
              if (task) void moveTask(task, column.id);
              setDraggingId(null);
            }}
            className="w-72 shrink-0 rounded-lg border border-border bg-muted/40"
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{column.name}</h3>
              <span className="text-xs text-muted-foreground">{column.items.length}</span>
            </header>
            <div className="min-h-24 space-y-2 p-2">
              {column.items.map((task) => (
                <article
                  key={task.id}
                  draggable
                  onDragStart={() => setDraggingId(task.id)}
                  onClick={() => openTask(task.id)}
                  className="cursor-pointer rounded-lg border border-border bg-card p-3 text-sm shadow-xs hover:border-primary/40"
                >
                  <div className="font-medium text-foreground">{task.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.status?.name || "No status"}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="sr-only">Project {projectId}</p>
    </div>
  );
}

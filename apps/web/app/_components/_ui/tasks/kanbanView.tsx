"use client";

import { useMemo, useState } from "react";
import type { Status, Task, Workspace } from "@/app/_types/types";
import { useUpdateTask, patchTaskInCache } from "@/app/utils/hooks/tasks";
import { isCompletedStatus } from "@/app/utils/status";
import { showUndoToast } from "@/app/_store/toastStore";
import { useQueryClient } from "@tanstack/react-query";

function formatDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusPatch(status: Status, completedAt: string | null) {
  const completing = isCompletedStatus(status);
  return {
    statusId: status.id,
    ...(completing && !completedAt
      ? { completedAt: new Date().toISOString() }
      : !completing && completedAt
        ? { completedAt: "" }
        : {}),
  };
}

export default function KanbanView({
  rows,
  dataMode,
  onSelectRow,
  workspaces,
  selectedWorkspaceIds,
  selectedStatusIds,
}: {
  rows: Task[];
  dataMode: "task" | "project";
  onSelectRow: (row: Task) => void;
  workspaces: Workspace[];
  selectedWorkspaceIds: string[];
  selectedStatusIds: string[];
}) {
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const columns = useMemo(() => {
    const scopedWorkspaces =
      selectedWorkspaceIds.length === 0
        ? workspaces
        : workspaces.filter((workspace) => selectedWorkspaceIds.includes(workspace.id));
    const showAllStatuses = selectedStatusIds.length === 0;
    const visibleStatusIds = new Set(selectedStatusIds);
    const order: Status[] = [];
    const seen = new Set<string>();

    for (const workspace of scopedWorkspaces) {
      for (const status of workspace.status ?? []) {
        if (!showAllStatuses && !visibleStatusIds.has(status.id)) continue;
        if (seen.has(status.id)) continue;
        seen.add(status.id);
        order.push(status);
      }
    }

    const byStatus = new Map<string, Task[]>();
    const uncategorized: Task[] = [];
    for (const row of rows) {
      const statusId = row.statusId ?? row.status?.id;
      if (statusId && seen.has(statusId)) {
        const existing = byStatus.get(statusId) ?? [];
        existing.push(row);
        byStatus.set(statusId, existing);
      } else if (showAllStatuses) {
        uncategorized.push(row);
      }
    }

    return {
      statuses: order.map((status) => ({
        status,
        items: byStatus.get(status.id) ?? [],
      })),
      uncategorized,
    };
  }, [rows, workspaces, selectedWorkspaceIds, selectedStatusIds]);

  const moveTask = async (task: Task, status: Status) => {
    if (dataMode !== "task") return;
    const previousStatusId = task.statusId ?? task.status?.id ?? "";
    const previousCompletedAt = task.completedAt ?? "";
    if (previousStatusId === status.id) return;
    const patch = statusPatch(status, task.completedAt);
    patchTaskInCache(queryClient, task.id, {
      statusId: status.id,
      status,
      completedAt: patch.completedAt ?? task.completedAt,
    });
    try {
      await updateTask.mutateAsync({ id: task.id, ...patch });
      showUndoToast(`Moved to ${status.name}`, () => {
        void updateTask.mutateAsync({
          id: task.id,
          statusId: previousStatusId,
          completedAt: previousCompletedAt,
        });
      });
    } catch {
      patchTaskInCache(queryClient, task.id, {
        statusId: previousStatusId || null,
        completedAt: previousCompletedAt || null,
      });
      showUndoToast("Could not update status");
    }
  };

  const sections = [
    ...columns.statuses.map((column) => ({
      key: column.status.id,
      name: column.status.name,
      color: column.status.color,
      items: column.items,
      status: column.status,
    })),
    ...(columns.uncategorized.length
      ? [
          {
            key: "none",
            name: "No status",
            color: undefined as string | undefined,
            items: columns.uncategorized,
            status: null as Status | null,
          },
        ]
      : []),
  ];

  if (sections.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No items found for Kanban view.</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex min-w-max gap-3 p-4">
        {sections.map((column) => (
          <section
            key={column.key}
            onDragOver={(event) => {
              if (dataMode === "task" && column.status) event.preventDefault();
            }}
            onDrop={() => {
              const task = rows.find((item) => item.id === draggingId);
              if (task && column.status) void moveTask(task, column.status);
              setDraggingId(null);
            }}
            className="w-72 shrink-0 rounded-lg border border-border bg-muted/40"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                {column.color ? (
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: column.color }} />
                ) : null}
                <span className="truncate">{column.name}</span>
              </h3>
              <span className="text-xs text-muted-foreground">{column.items.length}</span>
            </header>
            <div className="max-h-[calc(100vh-270px)] min-h-24 space-y-2 overflow-auto p-2">
              {column.items.map((item) => (
                <article
                  key={item.id}
                  draggable={dataMode === "task"}
                  onDragStart={() => setDraggingId(item.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRow(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRow(item);
                    }
                  }}
                  className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs hover:border-primary/40"
                >
                  <div className="line-clamp-2 text-sm font-medium text-foreground">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {dataMode === "project" ? "Project" : "Task"} · {item.workspace?.name || "No workspace"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Deadline: {formatDateLabel(item.deadline)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

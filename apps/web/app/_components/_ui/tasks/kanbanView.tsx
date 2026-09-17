"use client";

import { useMemo, useState } from "react";
import { CopyCheck, Plus } from "lucide-react";
import ColorChip from "@/app/_components/_ui/colorChip";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { useProjectContextMenu } from "@/app/utils/hooks/useProjectContextMenu";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useToastStore } from "@/app/_store/toastStore";
import type { Status, Task, Workspace } from "@/app/_types/types";
import { resolvedColor, taskEntityColor } from "@/app/utils/entityColor";
import { useUpdateTask, patchTaskInCache } from "@/app/utils/hooks/tasks";
import {
  isCompletedStatus,
  mergeStatusesByName,
  statusForWorkspace,
  statusNameKey,
  type NamedStatusGroup,
} from "@/app/utils/status";
import { showUndoToast } from "@/app/_store/toastStore";
import { useQueryClient } from "@tanstack/react-query";
import { isTaskOverdue, latestTaskSchedule } from "@/app/utils/overdue";
import { formatTaskDatePoint, nextTaskSlot, taskDateSourceLabel, taskNextDate } from "@/app/utils/taskDates";
import { motion } from "motion/react";
import { hoverLift, listItemVariants, springSoft } from "@/app/_components/_ui/motion";

function formatDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeOfDay(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Cards say when the work happens: deadline first, otherwise the next
 * reserved block, so scheduled tasks never read as "No date". Overdue cards
 * use the Report's red treatment and include time of day when a block exists. */
function cardDateMeta(item: Task, dataMode: "task" | "project"): { text: string; overdue: boolean } {
  if (dataMode === "project") {
    return { text: `Deadline: ${formatDateLabel(item.deadline)}`, overdue: false };
  }
  const overdue = isTaskOverdue(item);
  const point = taskNextDate(item);
  if (!point) return { text: "No date", overdue: false };
  if (!overdue) {
    return { text: `${taskDateSourceLabel(point.source)}: ${formatTaskDatePoint(point)}`, overdue: false };
  }
  const slot = nextTaskSlot(item) ?? latestTaskSchedule(item);
  if (slot) {
    const day = slot.end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { text: `Overdue: ${day} ${formatTimeOfDay(slot.end)}`, overdue: true };
  }
  return { text: `Overdue: ${formatTaskDatePoint(point)}`, overdue: true };
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
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const projectMenu = useProjectContextMenu();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);

  const columns = useMemo(() => {
    const scopedWorkspaces =
      selectedWorkspaceIds.length === 0
        ? workspaces
        : workspaces.filter((workspace) => selectedWorkspaceIds.includes(workspace.id));
    const catalog = scopedWorkspaces.flatMap((workspace) => workspace.status ?? []);
    const showAllStatuses = selectedStatusIds.length === 0;
    const selectedIds = new Set(selectedStatusIds);
    const selectedKeys = new Set(
      catalog
        .filter((status) => selectedIds.has(status.id))
        .map((status) => statusNameKey(status.name)),
    );
    const visible = showAllStatuses
      ? catalog
      : catalog.filter((status) => selectedKeys.has(statusNameKey(status.name)));
    const groups = mergeStatusesByName(visible);
    const groupByStatusId = new Map<string, string>();
    for (const group of groups) {
      for (const status of group.statuses) {
        groupByStatusId.set(status.id, group.key);
      }
    }

    const byGroup = new Map<string, Task[]>();
    const uncategorized: Task[] = [];
    for (const row of rows) {
      const statusId = row.statusId ?? row.status?.id;
      const groupKey = statusId ? groupByStatusId.get(statusId) : undefined;
      if (groupKey) {
        const existing = byGroup.get(groupKey) ?? [];
        existing.push(row);
        byGroup.set(groupKey, existing);
      } else if (showAllStatuses) {
        uncategorized.push(row);
      }
    }

    return {
      groups: groups.map((group) => ({
        ...group,
        items: byGroup.get(group.key) ?? [],
      })),
      uncategorized,
    };
  }, [rows, workspaces, selectedWorkspaceIds, selectedStatusIds]);

  const moveTask = async (task: Task, group: NamedStatusGroup) => {
    if (dataMode !== "task") return;
    const workspaceId = task.workspaceId ?? task.workspace?.id;
    const status = statusForWorkspace(group, workspaceId);
    if (!status) {
      const workspaceName = task.workspace?.name ?? "This workspace";
      showUndoToast(`${workspaceName} has no "${group.name}" status`);
      return;
    }
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

  const onCardContextMenu = (event: React.MouseEvent, item: Task) => {
    if (dataMode === "project") {
      if (!item.project) return;
      openMenu(event, projectMenu(item.project), { title: item.project.title });
      return;
    }
    openMenu(event, taskMenu(item), { title: item.name });
  };

  const onColumnContextMenu = (
    event: React.MouseEvent,
    column: { name: string; items: Task[] },
  ) => {
    openMenu(
      event,
      tidyEntries([
        dataMode === "task" && {
          kind: "action",
          label: "New task",
          icon: Plus,
          shortcut: "C",
          onSelect: () => {
            setAddNewMode("task");
            setIsAddItemModalOpen(true);
          },
        },
        column.items.length > 0 && {
          kind: "action",
          label: `Copy card names (${column.items.length})`,
          icon: CopyCheck,
          onSelect: () => {
            void navigator.clipboard
              .writeText(column.items.map((item) => item.name).join("\n"))
              .then(() =>
                useToastStore.getState().show(`Copied ${column.items.length} names`),
              )
              .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
          },
        },
      ]),
      { title: `${column.name} · ${column.items.length}` },
    );
  };

  const sections = [
    ...columns.groups.map((column) => ({
      key: column.key,
      name: column.name,
      color: column.color,
      items: column.items,
      group: column as NamedStatusGroup,
    })),
    ...(columns.uncategorized.length
      ? [
          {
            key: "none",
            name: "No status",
            color: undefined as string | undefined,
            items: columns.uncategorized,
            group: null as NamedStatusGroup | null,
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
              if (dataMode === "task" && column.group) event.preventDefault();
            }}
            onDrop={() => {
              const task = rows.find((item) => item.id === draggingId);
              if (task && column.group) void moveTask(task, column.group);
              setDraggingId(null);
            }}
            className="w-72 shrink-0 rounded-lg border border-border bg-muted/40"
          >
            <header
              onContextMenu={(event) => onColumnContextMenu(event, column)}
              className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"
            >
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                {column.color ? (
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: column.color }} />
                ) : null}
                <span className="truncate">{column.name}</span>
              </h3>
              <span className="text-xs text-muted-foreground">{column.items.length}</span>
            </header>
            <div className="max-h-[calc(100vh-270px)] min-h-24 space-y-2 overflow-auto p-2">
              {column.items.map((item) => {
                const dateMeta = cardDateMeta(item, dataMode);
                return (
                <motion.article
                  key={item.id}
                  layout
                  variants={listItemVariants}
                  initial="hidden"
                  animate="visible"
                  whileHover={hoverLift}
                  whileTap={{ scale: 0.99 }}
                  transition={springSoft}
                  draggable={dataMode === "task"}
                  onDragStart={() => setDraggingId(item.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRow(item)}
                  onContextMenu={(event) => onCardContextMenu(event, item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRow(item);
                    }
                  }}
                  className="cursor-pointer overflow-hidden rounded-lg border border-border bg-card shadow-xs hover:border-primary/40"
                >
                  <div className="flex items-stretch">
                    <span
                      className="w-1 shrink-0"
                      style={{ backgroundColor: taskEntityColor(item) }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 p-3">
                      <div className="line-clamp-2 text-sm font-medium text-foreground">{item.name}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.workspace?.name ? (
                          <ColorChip color={resolvedColor(item.workspace.color, item.workspace.id)}>
                            {item.workspace.name}
                          </ColorChip>
                        ) : (
                          <span className="text-xs text-muted-foreground">No workspace</span>
                        )}
                        {dataMode === "task" && item.project?.title ? (
                          <ColorChip color={resolvedColor(item.project.color, item.project.id)}>
                            {item.project.title}
                          </ColorChip>
                        ) : null}
                      </div>
                      <div className={dateMeta.overdue ? "mt-2 text-xs text-destructive" : "mt-2 text-xs text-muted-foreground"}>
                        {dateMeta.text}
                      </div>
                    </div>
                  </div>
                </motion.article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

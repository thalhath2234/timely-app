"use client";

import { useMemo, useState } from "react";
import { CopyCheck, Plus } from "lucide-react";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { useProjectContextMenu } from "@/app/utils/hooks/useProjectContextMenu";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useToastStore } from "@/app/_store/toastStore";
import type { Status, Task, TaskListGroupField, Workspace } from "@/app/_types/types";
import { PRIORITIES, priorityColor } from "@/app/utils/priority";
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
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { BUCKET_GROUP_FIELDS, bucketGroupLabels, bucketGroupRank, queryContext } from "@timely/contract/taskQuery";
import { latestTaskSchedule } from "@/app/utils/overdue";
import { useWorkingHoursZone } from "@/app/utils/hooks/workspaces";
import { formatTaskDatePoint, nextTaskSlot, taskDateSourceLabel, taskNextDate } from "@/app/utils/taskDates";
import { motion } from "motion/react";
import { hoverLift, listItemVariants, springSoft } from "@/app/_components/_ui/motion";
import { plural } from "@/app/utils/plural";

function formatDateLabel(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeOfDay(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const UNCATEGORIZED_NAMES: Record<string, string> = {
  status: "No status",
  priority: "No priority",
  workspace: "No workspace",
  project: "No project",
  stage: "No stage",
};

/** Cards say when the work happens: deadline first, otherwise the next
 * reserved block, so scheduled tasks never read as "No date". Overdue cards
 * use the Dashboard's red treatment and include time of day when a block exists. */
export function cardDateMeta(
  item: Task,
  dataMode: "task" | "project",
  today: string,
): { text: string; short: string; overdue: boolean } {
  if (dataMode === "project") {
    const short = formatDateLabel(item.deadline);
    return { text: `Deadline: ${short}`, short, overdue: false };
  }
  const overdue = isOverdue(item, today);
  const point = taskNextDate(item);
  if (!point) return { text: "No date", short: "", overdue: false };
  if (!overdue) {
    const short = formatTaskDatePoint(point);
    return { text: `${taskDateSourceLabel(point.source)}: ${short}`, short, overdue: false };
  }
  const slot = nextTaskSlot(item) ?? latestTaskSchedule(item);
  if (slot) {
    const day = slot.end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { text: `Overdue: ${day} ${formatTimeOfDay(slot.end)}`, short: `Overdue ${day}`, overdue: true };
  }
  const short = formatTaskDatePoint(point);
  return { text: `Overdue: ${short}`, short: `Overdue ${short}`, overdue: true };
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
  selectedPriorityLevels,
  groupField = "status",
}: {
  rows: Task[];
  dataMode: "task" | "project";
  onSelectRow: (row: Task) => void;
  workspaces: Workspace[];
  selectedWorkspaceIds: string[];
  selectedStatusIds: string[];
  selectedPriorityLevels?: string[];
  groupField?: TaskListGroupField;
}) {
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const timeZone = useWorkingHoursZone();
  const today = todayInZone(timeZone);
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
    if (groupField === "priority") {
      const levels = selectedPriorityLevels?.length ? PRIORITIES.filter((level) => selectedPriorityLevels.includes(level)) : PRIORITIES;
      const priorityGroups = levels.map((level) => ({ key: level, name: level, color: priorityColor(level), items: rows.filter((row) => row.priorityLevel === level), statuses: [] as Status[] }));
      const noPriority = rows.filter((row) => !row.priorityLevel);
      return { groups: priorityGroups, uncategorized: noPriority };
    }
    if (BUCKET_GROUP_FIELDS.has(groupField)) {
      // Date buckets, labels, effort, done and repeating: columns in their
      // natural order (Overdue, Today, ...); a card with two labels shows twice.
      const ctx = queryContext(rows, timeZone);
      const byLabel = new Map<string, { key: string; name: string; color: string | null; items: Task[]; statuses: Status[] }>();
      for (const row of rows) {
        for (const label of bucketGroupLabels(row, groupField, ctx) ?? []) {
          const existing = byLabel.get(label) ?? {
            key: `bucket:${label}`,
            name: label,
            color: groupField === "label" ? row.labels?.find((item) => item.name === label)?.color ?? null : null,
            items: [],
            statuses: [],
          };
          existing.items.push(row);
          byLabel.set(label, existing);
        }
      }
      const groups = [...byLabel.values()].sort((a, b) => {
        const left = bucketGroupRank(groupField, a.name);
        const right = bucketGroupRank(groupField, b.name);
        if (left !== undefined && right !== undefined && left !== right) return left - right;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      });
      return { groups, uncategorized: [] as Task[] };
    }
    if (groupField !== "status") {
      const byValue = new Map<string, { key: string; name: string; color: string | null; items: Task[]; statuses: Status[] }>();
      const missing: Task[] = [];
      for (const row of rows) {
        const stage = groupField === "stage" ? row.stage ?? row.project?.stages?.find((candidate) => candidate.id === row.stageId) ?? null : null;
        const value = groupField === "workspace" ? row.workspace : groupField === "project" ? row.project : stage;
        const id = groupField === "stage" ? row.stageId : value?.id;
        const name = groupField === "stage" ? stage?.name : groupField === "project" ? row.project?.title : row.workspace?.name;
        if (!id) { missing.push(row); continue; }
        // The entity's own colour, else the same auto colour its cards use.
        const existing = byValue.get(id) ?? { key: id, name: name || "Untitled", color: resolvedColor(value?.color, id), items: [], statuses: [] };
        existing.items.push(row);
        byValue.set(id, existing);
      }
      return { groups: [...byValue.values()], uncategorized: missing };
    }
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
  }, [rows, workspaces, selectedWorkspaceIds, selectedStatusIds, selectedPriorityLevels, groupField, timeZone]);

  const moveTask = async (task: Task, group: NamedStatusGroup & { key: string; name: string }) => {
    if (dataMode !== "task") return;
    if (groupField !== "status") {
      const field = groupField === "priority" ? "priorityLevel" : groupField === "workspace" ? "workspaceId" : groupField === "project" ? "projectId" : groupField === "stage" ? "stageId" : null;
      if (!field) return;
      const next = group.key === "none" ? "" : group.key;
      const previous = String(task[field] ?? "");
      if (next === previous) return;
      try {
        await updateTask.mutateAsync({ id: task.id, [field]: next });
        showUndoToast(`Moved to ${group.name}`, () => { void updateTask.mutateAsync({ id: task.id, [field]: previous }); });
      } catch { showUndoToast("Could not move task"); }
      return;
    }
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
                useToastStore.getState().show(`Copied ${plural(column.items.length, "name")}`),
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
            name: UNCATEGORIZED_NAMES[groupField] ?? "No value",
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

  // Up to six columns share the width (the film's board fills the page);
  // columns with nothing in them fold to a narrow strip that still takes a
  // drop. More columns than that scroll sideways at a fixed width.
  const fills = sections.length <= 6;
  const template = fills
    ? sections.map((column) => (column.items.length ? "minmax(220px, 1fr)" : "2.75rem")).join(" ")
    : undefined;

  return (
    <div className="h-full overflow-auto">
      <div
        className={fills ? "grid gap-3 p-4" : "flex min-w-max gap-3 p-4"}
        style={fills ? { gridTemplateColumns: template } : undefined}
        data-testid="kanban-board"
      >
        {sections.map((column) => {
          const folded = column.items.length === 0 && fills;
          return (
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
            data-folded={folded || undefined}
            className={
              folded
                ? "flex min-h-40 flex-col items-center rounded-lg border border-dashed border-border bg-muted/20 py-2 text-muted-foreground transition-colors hover:border-primary/40"
                : fills
                  ? "min-w-0 rounded-lg border border-border bg-muted/40"
                  : "w-72 shrink-0 rounded-lg border border-border bg-muted/40"
            }
          >
            {folded ? (
              <h3
                onContextMenu={(event) => onColumnContextMenu(event, column)}
                className="flex items-center gap-2 text-xs font-semibold [writing-mode:vertical-rl]"
                title={`${column.name}: nothing here. Drop a card to move it.`}
              >
                {column.color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: column.color }} /> : null}
                <span className="truncate">{column.name}</span>
              </h3>
            ) : (
              <>
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
              <span className="text-xs tabular-nums text-muted-foreground">{column.items.length}</span>
            </header>
            <div className="max-h-[calc(100vh-230px)] min-h-24 space-y-1.5 overflow-auto p-2">
              {column.items.map((item) => {
                const dateMeta = cardDateMeta(item, dataMode, today);
                const where = dataMode === "task" && item.project?.title ? item.project.title : item.workspace?.name ?? null;
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
                  {/* One line per card: a colour strip, the name, and when; the
                      project (or workspace) as a small second line only when there is one. */}
                  <div className="flex items-stretch">
                    <span
                      className="w-1 shrink-0"
                      style={{ backgroundColor: taskEntityColor(item) }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 px-2.5 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={item.completedAt ? "truncate text-[13px] font-medium text-muted-foreground line-through" : "truncate text-[13px] font-medium text-foreground"}>{item.name}</span>
                        <span title={dateMeta.text} className={dateMeta.overdue ? "shrink-0 text-[11px] tabular-nums text-destructive" : "shrink-0 text-[11px] tabular-nums text-muted-foreground"}>
                          {dateMeta.short}
                        </span>
                      </div>
                      {where ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{where}</div> : null}
                    </div>
                  </div>
                </motion.article>
                );
              })}
            </div>
              </>
            )}
          </section>
          );
        })}
      </div>
    </div>
  );
}

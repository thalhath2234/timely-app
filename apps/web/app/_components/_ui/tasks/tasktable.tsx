"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Config,
  CustomField,
  Task,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortBy,
  TaskListSortDirection,
} from "@/app/_types/types";
import { useTasks } from "@/app/utils/hooks/tasks";
import { cn } from "@/app/utils/cn";
import { resolvedColor } from "@/app/utils/entityColor";
import { priorityColor } from "@/app/utils/priority";
import { filterTasks, type TaskListFilters } from "@/app/utils/taskFilters";
import ColorChip from "@/app/_components/_ui/colorChip";

type TasksTableProps = {
  config: Config;
  dataMode: TaskListDataMode;
  groupFields: TaskListGroupField[];
  groupSortDirection: TaskListGroupSortDirection;
  groupValueOrders: Record<string, string[]>;
  selectedWorkspaceIds: string[];
  sortBy: TaskListSortBy;
  sortDirection: TaskListSortDirection;
  columnOrder: string[];
  onColumnOrderChange: (order: string[]) => void;
  onSelectRow: (row: Task) => void;
  filters?: TaskListFilters;
  stageNames?: Record<string, string>;
  stageColors?: Record<string, string>;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
};

const BUILTIN_COLUMNS = [
  { id: "name", label: "Task", width: "w-64", align: "left" },
  { id: "description", label: "Description", width: "w-80", align: "left" },
  { id: "duration", label: "Duration", width: "w-24", align: "right" },
  { id: "startDate", label: "Start Date", width: "w-32", align: "center" },
  { id: "deadline", label: "Deadline", width: "w-32", align: "center" },
  { id: "scheduledOn", label: "Scheduled On", width: "w-32", align: "center" },
  { id: "completedAt", label: "Completed At", width: "w-32", align: "center" },
  { id: "createdAt", label: "Created At", width: "w-32", align: "center" },
  { id: "updatedAt", label: "Updated At", width: "w-32", align: "center" },
  { id: "project", label: "Project", width: "w-44", align: "left" },
  { id: "workspace", label: "Workspace", width: "w-48", align: "left" },
  { id: "blockedBy", label: "Blocked By", width: "w-36", align: "left" },
  { id: "priority", label: "Priority", width: "w-24", align: "center" },
  { id: "stageId", label: "Stage", width: "w-32", align: "left" },
  { id: "status", label: "Status", width: "w-32", align: "left" },
  { id: "labels", label: "Labels", width: "w-36", align: "left" },
] as const;

type ColumnAlign = "left" | "center" | "right";

type ListColumn = {
  id: string;
  label: string;
  width: string;
  align: ColumnAlign;
};

function customFieldColumn(field: CustomField): ListColumn {
  return {
    id: `cf:${field.id}`,
    label: field.name,
    width: "w-44",
    align: "left",
  };
}

function defaultListColumns(customFields: CustomField[]): ListColumn[] {
  return [
    ...BUILTIN_COLUMNS.map((column) => ({ ...column })),
    ...customFields.map(customFieldColumn),
  ];
}

function resolveListColumns(
  savedOrder: string[],
  customFields: CustomField[],
): ListColumn[] {
  const available = defaultListColumns(customFields);
  const byId = new Map(available.map((column) => [column.id, column]));
  const ordered: ListColumn[] = [];

  for (const id of savedOrder) {
    const column = byId.get(id);
    if (!column) continue;
    ordered.push(column);
    byId.delete(id);
  }

  for (const column of available) {
    if (byId.has(column.id)) ordered.push(column);
  }

  return ordered;
}

function reorderColumnIds(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function columnShiftX(
  fromIndex: number,
  overIndex: number,
  index: number,
  width: number,
): number {
  if (index === fromIndex || fromIndex === overIndex) return 0;
  if (fromIndex < overIndex && index > fromIndex && index <= overIndex) return -width;
  if (fromIndex > overIndex && index >= overIndex && index < fromIndex) return width;
  return 0;
}

type ColumnSlot = { left: number; width: number };

type LiveColumnDrag = {
  id: string;
  fromIndex: number;
  overIndex: number;
  width: number;
  label: string;
  slots: ColumnSlot[];
  startX: number;
  lastClientX: number;
  grabOffsetX: number;
  originTop: number;
  headerHeight: number;
  startScrollLeft: number;
  pointerId: number;
  active: boolean;
};

type ColumnDragState = {
  id: string;
  fromIndex: number;
  overIndex: number;
  width: number;
  label: string;
};

function dropSlotLeft(
  slots: ColumnSlot[],
  fromIndex: number,
  overIndex: number,
  draggedWidth: number,
  scrollDx: number,
): number | null {
  if (fromIndex === overIndex) return null;
  const slot = slots[overIndex];
  if (!slot) return null;
  if (fromIndex < overIndex) {
    return slot.left + slot.width - draggedWidth - scrollDx;
  }
  return slot.left - scrollDx;
}

type GroupNode = {
  key: string;
  label: string;
  color: string | null;
  depth: number;
  count: number;
  children: GroupNode[];
  rows: Task[];
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function getPriorityWeight(priority?: string | null): number {
  switch ((priority ?? "").trim().toLowerCase()) {
    case "critical":
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function getCustomFieldDisplayValue(task: Task, fieldId: string): string {
  const value = task.customFieldValues?.find((entry) => entry.customFieldId === fieldId);
  if (!value) return "-";

  if (value.optionValue?.length) {
    return value.optionValue.map((option) => option.value).join(", ");
  }

  if (value.stringValue) return value.stringValue;
  if (typeof value.numberValue === "number") return String(value.numberValue);
  if (value.dateValue) return formatDate(value.dateValue);
  if (typeof value.boolValue === "boolean") return value.boolValue ? "Yes" : "No";

  return "-";
}

/** Resolves a task's display label and color for the requested grouping field. */
function getGroupMeta(
  task: Task,
  groupBy: TaskListGroupField,
  stageNames: Record<string, string> = {},
  stageColors: Record<string, string> = {},
): { label: string; color: string | null } {
  if (groupBy === "workspace") {
    return {
      label: task.workspace?.name || "No workspace",
      color: resolvedColor(task.workspace?.color, task.workspace?.id ?? task.workspaceId),
    };
  }
  if (groupBy === "project") {
    return {
      label: task.project?.title || "No project",
      color: resolvedColor(task.project?.color, task.project?.id ?? task.projectId),
    };
  }
  if (groupBy === "status") {
    return { label: task.status?.name || "No status", color: task.status?.color ?? null };
  }
  if (groupBy === "priority") {
    return { label: task.priorityLevel || "No priority", color: priorityColor(task.priorityLevel) };
  }
  if (groupBy === "stage") {
    return {
      label: (task.stageId && stageNames[task.stageId]) || task.stage?.name || "No stage",
      color: (task.stageId && stageColors[task.stageId]) || task.stage?.color || null,
    };
  }
  if (groupBy.startsWith("cf:")) {
    return { label: getCustomFieldDisplayValue(task, groupBy.slice(3)), color: null };
  }
  return { label: "No group", color: null };
}

function compareGroupLabel(
  a: string,
  b: string,
  direction: TaskListGroupSortDirection,
  customOrder?: string[]
): number {
  if (customOrder && customOrder.length > 0) {
    const aIndex = customOrder.indexOf(a);
    const bIndex = customOrder.indexOf(b);

    if (aIndex >= 0 && bIndex >= 0) {
      return aIndex - bIndex;
    }

    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
  }

  const compared = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return direction === "asc" ? compared : compared * -1;
}

/** Recursively organizes task rows into sorted groups for the table. */
function buildNestedGroups(
  rows: Task[],
  groupFields: TaskListGroupField[],
  groupSortDirection: TaskListGroupSortDirection,
  groupValueOrders: Record<string, string[]>,
  stageNames: Record<string, string> = {},
  stageColors: Record<string, string> = {},
  depth = 0,
  parentKey = ""
): GroupNode[] {
  if (depth >= groupFields.length) return [];

  const field = groupFields[depth];
  const grouped = new Map<string, { color: string | null; rows: Task[] }>();

  rows.forEach((task) => {
    const meta = getGroupMeta(task, field, stageNames, stageColors);
    const existing = grouped.get(meta.label);
    if (existing) {
      existing.rows.push(task);
      if (!existing.color && meta.color) existing.color = meta.color;
    } else {
      grouped.set(meta.label, { color: meta.color, rows: [task] });
    }
  });

  return Array.from(grouped.entries())
    .sort(([aLabel], [bLabel]) =>
      compareGroupLabel(aLabel, bLabel, groupSortDirection, groupValueOrders[field])
    )
    .map(([label, group]) => {
      const nodeKey = parentKey ? `${parentKey}::${label}` : label;
      const children = buildNestedGroups(
        group.rows,
        groupFields,
        groupSortDirection,
        groupValueOrders,
        stageNames,
        stageColors,
        depth + 1,
        nodeKey
      );

      return {
        key: nodeKey,
        label,
        color: group.color,
        depth,
        count: group.rows.length,
        children,
        rows: group.rows,
      };
    });
}

function compareTasks(a: Task, b: Task, sortBy: TaskListSortBy): number {
  switch (sortBy) {
    case "name":
      return (a.name || "").localeCompare(b.name || "");
    case "deadline":
      return (new Date(a.deadline || "").getTime() || 0) - (new Date(b.deadline || "").getTime() || 0);
    case "startDate":
      return (new Date(a.startDate || "").getTime() || 0) - (new Date(b.startDate || "").getTime() || 0);
    case "createdAt":
      return (new Date(a.createdAt || "").getTime() || 0) - (new Date(b.createdAt || "").getTime() || 0);
    case "priority":
      return getPriorityWeight(a.priorityLevel) - getPriorityWeight(b.priorityLevel);
    case "status":
      return (a.status?.name || "").localeCompare(b.status?.name || "");
    case "project":
      return (a.project?.title || "").localeCompare(
        b.project?.title || ""
      );
    default:
      return 0;
  }
}

function getBlockedByDisplayValue(task: Task): string {
  const blockedBy = (task as Task & { blockedBy?: { id: string; name?: string } | null }).blockedBy;
  if (blockedBy?.name) return blockedBy.name;
  if (blockedBy?.id) return blockedBy.id;
  return task.blockedById || "-";
}

function buildProjectRows(tasks: Task[]): Task[] {
  const projects = new Map<string, Task[]>();

  tasks.forEach((task) => {
    const projectId = task.project?.id || task.projectId;
    if (!projectId) return;
    const existing = projects.get(projectId) ?? [];
    existing.push(task);
    projects.set(projectId, existing);
  });

  return Array.from(projects.entries()).map(([projectId, projectTasks]) => {
    const first = projectTasks[0];
    const project = first.project;
    const totalDuration = projectTasks.reduce((sum, item) => sum + (item.duration || 0), 0);

    return {
      id: `project-${projectId}`,
      name: project?.title || "Untitled project",
      description: project?.description || "",
      timeChunks: 0,
      duration: totalDuration,
      deadline: project?.deadline || null,
      startDate: project?.startDate || null,
      scheduledOn: null,
      completedAt: project?.completedAt || null,
      createdAt: project?.createdAt || first.createdAt,
      updatedAt: project?.updatedAt || first.updatedAt,
      userId: first.userId,
      projectId,
      statusId: project?.statusId || null,
      priorityLevel: project?.priorityLevel || first.priorityLevel || null,
      workspaceId: project?.workspaceId || first.workspaceId || null,
      scheduleId: null,
      stageId: null,
      blockedById: null,
      project,
      workspace: first.workspace,
      status: first.status,
      customFieldValues: [],
      labelIds: [],
      labels: [],
    };
  });
}

/** Renders configurable task rows, nested groups, and bulk-selection controls. */
export default function TasksTable({
  config,
  dataMode,
  groupFields,
  groupSortDirection,
  groupValueOrders,
  selectedWorkspaceIds,
  sortBy,
  sortDirection,
  columnOrder,
  onColumnOrderChange,
  onSelectRow,
  filters,
  stageNames = {},
  stageColors = {},
  selectedIds = [],
  onSelectedIdsChange,
}: TasksTableProps) {
  const { data: tasks, isLoading, status } = useTasks();
  const typedTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const customFields = useMemo(() => config.customFields ?? [], [config.customFields]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [columnDrag, setColumnDrag] = useState<ColumnDragState | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const headerCellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const liveDragRef = useRef<LiveColumnDrag | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dropPreviewRef = useRef<HTMLDivElement>(null);

  const dataRows = useMemo(() => {
    const source = filters ? filterTasks(typedTasks, filters) : typedTasks;
    return dataMode === "project" ? buildProjectRows(source) : source;
  }, [dataMode, typedTasks, filters]);

  const filteredRows = useMemo(() => {
    if (filters) return dataRows;
    if (selectedWorkspaceIds.length === 0) return dataRows;

    return dataRows.filter((row) => {
      const workspaceId = row.workspace?.id || row.workspaceId;
      if (!workspaceId) return false;
      return selectedWorkspaceIds.includes(workspaceId);
    });
  }, [dataRows, selectedWorkspaceIds, filters]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const compared = compareTasks(a, b, sortBy);
      return sortDirection === "asc" ? compared : compared * -1;
    });

    return sorted;
  }, [filteredRows, sortBy, sortDirection]);

  const nestedGroups = useMemo(
    () => buildNestedGroups(sortedTasks, groupFields, groupSortDirection, groupValueOrders, stageNames, stageColors),
    [sortedTasks, groupFields, groupSortDirection, groupValueOrders, stageNames, stageColors]
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const columns = useMemo(
    () => resolveListColumns(columnOrder, customFields),
    [columnOrder, customFields],
  );

  const canSelect = dataMode === "task" && Boolean(onSelectedIdsChange);
  const visibleIds = sortedTasks.map((task) => task.id);
  const allSelected =
    canSelect && visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleRow = (id: string) => {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    );
  };

  const selectCell = (task: Task) =>
    canSelect ? (
      <td
        className="w-10 px-2 align-middle"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selectedIds.includes(task.id)}
          onChange={() => toggleRow(task.id)}
          className="accent-primary"
        />
      </td>
    ) : null;

  const updateDragOverlays = useCallback((clientX?: number) => {
    const live = liveDragRef.current;
    const wrap = tableWrapRef.current;
    if (!live?.active || !wrap) return;

    const wrapRect = wrap.getBoundingClientRect();
    const scrollDx = wrap.scrollLeft - live.startScrollLeft;
    const ghost = ghostRef.current;
    if (ghost) {
      const x = (clientX ?? live.lastClientX) - live.grabOffsetX;
      ghost.style.width = `${live.width}px`;
      ghost.style.height = `${live.headerHeight}px`;
      ghost.style.transform = `translate3d(${x}px, ${wrapRect.top}px, 0) scale(1.02)`;
      ghost.style.transformOrigin = "top left";
    }

    const preview = dropPreviewRef.current;
    if (preview) {
      const left = dropSlotLeft(
        live.slots,
        live.fromIndex,
        live.overIndex,
        live.width,
        scrollDx,
      );
      if (left === null) {
        preview.style.opacity = "0";
      } else {
        preview.style.opacity = "1";
        preview.style.left = `${left}px`;
        preview.style.top = `${wrapRect.top}px`;
        preview.style.width = `${live.width}px`;
        preview.style.height = `${wrapRect.height}px`;
      }
    }
  }, []);

  const stopColumnDrag = useCallback((commit: boolean) => {
    const live = liveDragRef.current;
    liveDragRef.current = null;

    if (commit && live?.active && live.overIndex !== live.fromIndex) {
      onColumnOrderChange(
        reorderColumnIds(
          columns.map((column) => column.id),
          live.fromIndex,
          live.overIndex,
        ),
      );
    }

    setColumnDrag(null);
  }, [columns, onColumnOrderChange]);

  const onColumnPointerDown = useCallback(
    (column: ListColumn, event: ReactPointerEvent<HTMLTableCellElement>) => {
      if (event.button !== 0) return;

      const header = event.currentTarget;
      const wrap = tableWrapRef.current;
      const index = columns.findIndex((item) => item.id === column.id);
      if (index < 0 || !wrap) return;

      event.preventDefault();
      header.setPointerCapture(event.pointerId);

      const slots = columns.map((item) => {
        const el = headerCellRefs.current.get(item.id);
        const rect = el?.getBoundingClientRect();
        return { left: rect?.left ?? 0, width: rect?.width ?? 0 };
      });
      const rect = header.getBoundingClientRect();

      liveDragRef.current = {
        id: column.id,
        fromIndex: index,
        overIndex: index,
        width: rect.width,
        label:
          column.id === "name"
            ? dataMode === "project"
              ? "Project"
              : "Task"
            : column.label,
        slots,
        startX: event.clientX,
        lastClientX: event.clientX,
        grabOffsetX: event.clientX - rect.left,
        originTop: rect.top,
        headerHeight: rect.height,
        startScrollLeft: wrap.scrollLeft,
        pointerId: event.pointerId,
        active: false,
      };
    },
    [columns, dataMode],
  );

  const onColumnPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLTableCellElement>) => {
      const live = liveDragRef.current;
      if (!live || live.pointerId !== event.pointerId) return;

      const wrap = tableWrapRef.current;
      const deltaX = event.clientX - live.startX;
      if (!live.active) {
        if (Math.abs(deltaX) < 6) return;
        live.active = true;
        setColumnDrag({
          id: live.id,
          fromIndex: live.fromIndex,
          overIndex: live.fromIndex,
          width: live.width,
          label: live.label,
        });
      }

      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        if (event.clientX > rect.right - 48) wrap.scrollLeft += 18;
        else if (event.clientX < rect.left + 48) wrap.scrollLeft -= 18;
      }

      const scrollDx = (wrap?.scrollLeft ?? 0) - live.startScrollLeft;
      let overIndex = live.slots.length - 1;
      if (event.clientX < live.slots[0].left - scrollDx) {
        overIndex = 0;
      } else {
        for (let i = 0; i < live.slots.length; i += 1) {
          const right = live.slots[i].left - scrollDx + live.slots[i].width;
          if (event.clientX < right) {
            overIndex = i;
            break;
          }
        }
      }

      live.lastClientX = event.clientX;

      if (overIndex !== live.overIndex) {
        live.overIndex = overIndex;
        setColumnDrag((current) =>
          current ? { ...current, overIndex } : current,
        );
      }

      updateDragOverlays(event.clientX);
    },
    [updateDragOverlays],
  );

  const onColumnPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLTableCellElement>) => {
      const live = liveDragRef.current;
      if (!live || live.pointerId !== event.pointerId) return;
      stopColumnDrag(true);
    },
    [stopColumnDrag],
  );

  const onColumnPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLTableCellElement>) => {
      const live = liveDragRef.current;
      if (!live || live.pointerId !== event.pointerId) return;
      stopColumnDrag(false);
    },
    [stopColumnDrag],
  );

  useLayoutEffect(() => {
    if (!columnDrag) return;
    updateDragOverlays();
  }, [columnDrag, updateDragOverlays]);

  useEffect(() => {
    if (!columnDrag) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopColumnDrag(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [columnDrag, stopColumnDrag]);

  const headerOffset = 36;

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  }

  if (status === "error") {
    return (
      <div className="p-4 text-sm text-destructive">Something went wrong</div>
    );
  }

  if (!sortedTasks.length) {
    return <div className="p-4 text-sm text-muted-foreground">No tasks yet.</div>;
  }

  const headerCellClass =
    "px-3 py-2 font-medium whitespace-nowrap bg-muted/60 text-muted-foreground align-middle";
  const textCell = "px-3 py-2 text-foreground whitespace-nowrap align-middle";
  const primaryTextCell = "px-3 py-2 font-medium text-foreground whitespace-nowrap align-middle";
  const descriptionCell = "px-3 py-2 text-muted-foreground max-w-80 truncate align-middle";
  const numericCell = "px-3 py-2 text-muted-foreground text-right tabular-nums whitespace-nowrap align-middle";
  const dateCell = "px-3 py-2 text-muted-foreground text-center tabular-nums whitespace-nowrap align-middle";

  const alignHeader = (align: ColumnAlign) =>
    align === "center" ? "text-center" : align === "right" ? "text-right" : "";

  const columnMotionStyle = (columnId: string): CSSProperties => {
    if (!columnDrag) return {};
    const index = columns.findIndex((column) => column.id === columnId);
    if (index < 0) return {};
    const isDragged = columnId === columnDrag.id;
    const x = columnShiftX(
      columnDrag.fromIndex,
      columnDrag.overIndex,
      index,
      columnDrag.width,
    );
    return {
      transform: `translate3d(${x}px, 0, 0)`,
      transition: isDragged
        ? "opacity 150ms ease"
        : "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      opacity: isDragged ? 0 : 1,
      position: "relative",
      zIndex: isDragged ? 0 : 1,
      willChange: "transform",
    };
  };

  const bodyCellClass = (base: string, columnId: string) =>
    cn(base, columnDrag && columnDrag.id !== columnId && "bg-background");

  /** Renders one configured column value for a task row. */
  const renderColumnCell = (column: ListColumn, task: Task, indentDepth = 0): ReactNode => {
    if (column.id.startsWith("cf:")) {
      return (
        <td
          key={column.id}
          className={bodyCellClass(textCell, column.id)}
          style={columnMotionStyle(column.id)}
        >
          {getCustomFieldDisplayValue(task, column.id.slice(3))}
        </td>
      );
    }

    switch (column.id) {
      case "name":
        return (
          <td
            key={column.id}
            className={bodyCellClass(primaryTextCell, column.id)}
            style={{
              paddingLeft: `${12 + indentDepth * 16}px`,
              ...columnMotionStyle(column.id),
            }}
          >
            {task.name}
          </td>
        );
      case "description":
        return (
          <td
            key={column.id}
            className={bodyCellClass(descriptionCell, column.id)}
            style={columnMotionStyle(column.id)}
          >
            {task.description || "-"}
          </td>
        );
      case "duration":
        return (
          <td
            key={column.id}
            className={bodyCellClass(numericCell, column.id)}
            style={columnMotionStyle(column.id)}
          >
            {typeof task.duration === "number" ? `${task.duration}m` : "-"}
          </td>
        );
      case "startDate":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.startDate)}
          </td>
        );
      case "deadline":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.deadline)}
          </td>
        );
      case "scheduledOn":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.scheduledOn)}
          </td>
        );
      case "completedAt":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.completedAt)}
          </td>
        );
      case "createdAt":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.createdAt)}
          </td>
        );
      case "updatedAt":
        return (
          <td key={column.id} className={bodyCellClass(dateCell, column.id)} style={columnMotionStyle(column.id)}>
            {formatDate(task.updatedAt)}
          </td>
        );
      case "project":
        return (
          <td key={column.id} className={bodyCellClass(textCell, column.id)} style={columnMotionStyle(column.id)}>
            {task.project?.title ? (
              <ColorChip color={resolvedColor(task.project.color, task.project.id)}>
                {task.project.title}
              </ColorChip>
            ) : (
              "-"
            )}
          </td>
        );
      case "workspace":
        return (
          <td key={column.id} className={bodyCellClass(textCell, column.id)} style={columnMotionStyle(column.id)}>
            {task.workspace?.name ? (
              <ColorChip color={resolvedColor(task.workspace.color, task.workspace.id)}>
                {task.workspace.name}
              </ColorChip>
            ) : (
              "-"
            )}
          </td>
        );
      case "blockedBy":
        return (
          <td key={column.id} className={bodyCellClass(textCell, column.id)} style={columnMotionStyle(column.id)}>
            {getBlockedByDisplayValue(task)}
          </td>
        );
      case "priority":
        return (
          <td
            key={column.id}
            className={bodyCellClass(
              "px-3 py-2 text-center text-muted-foreground whitespace-nowrap align-middle",
              column.id,
            )}
            style={columnMotionStyle(column.id)}
          >
            {task.priorityLevel ? (
              <ColorChip color={priorityColor(task.priorityLevel)} dot={false}>
                {task.priorityLevel}
              </ColorChip>
            ) : (
              "-"
            )}
          </td>
        );
      case "stageId":
        return (
          <td
            key={column.id}
            className={bodyCellClass(
              "px-3 py-2 text-center text-muted-foreground tabular-nums whitespace-nowrap align-middle",
              column.id,
            )}
            style={columnMotionStyle(column.id)}
          >
            {task.stageId ? (
              <ColorChip
                color={
                  stageColors[task.stageId] ||
                  task.stage?.color ||
                  resolvedColor(null, task.stageId)
                }
              >
                {stageNames[task.stageId] || task.stage?.name || task.stageId}
              </ColorChip>
            ) : (
              "-"
            )}
          </td>
        );
      case "status":
        return (
          <td
            key={column.id}
            className={bodyCellClass("px-3 py-2 align-middle", column.id)}
            style={columnMotionStyle(column.id)}
          >
            <ColorChip color={task.status?.color} dot={false}>
              {task.status?.name || "-"}
            </ColorChip>
          </td>
        );
      case "labels":
        return (
          <td
            key={column.id}
            className={bodyCellClass("px-3 py-2 align-middle", column.id)}
            style={columnMotionStyle(column.id)}
          >
            <div className="flex flex-wrap gap-1">
              {(task.labels ?? []).length === 0 && (
                <span className="text-muted-foreground">-</span>
              )}
              {(task.labels ?? []).map((label) => (
                <ColorChip key={label.id} color={label.color} dot={false}>
                  {label.name}
                </ColorChip>
              ))}
            </div>
          </td>
        );
      default:
        return (
          <td key={column.id} className={bodyCellClass(textCell, column.id)} style={columnMotionStyle(column.id)}>
            -
          </td>
        );
    }
  };

  const renderTaskCells = (task: Task, indentDepth = 0) => (
    <>
      {columns.map((column) => renderColumnCell(column, task, indentDepth))}
    </>
  );

  return (
    <div
      ref={tableWrapRef}
      className={cn(
        "relative isolate h-full w-full overflow-x-auto overflow-y-auto",
        columnDrag && "select-none",
      )}
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <colgroup>
          {canSelect ? <col className="w-10" /> : null}
          {columns.map((column) => (
            <col key={`col-${column.id}`} className={column.width} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-30">
          <tr className="border-b border-border bg-muted/60 text-left">
            {canSelect ? (
              <th className="w-10 px-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    onSelectedIdsChange?.(allSelected ? [] : visibleIds)
                  }
                  className="accent-primary"
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th
                key={column.id}
                ref={(element) => {
                  if (element) headerCellRefs.current.set(column.id, element);
                  else headerCellRefs.current.delete(column.id);
                }}
                title="Drag to reorder"
                onPointerDown={(event) => onColumnPointerDown(column, event)}
                onPointerMove={onColumnPointerMove}
                onPointerUp={onColumnPointerUp}
                onPointerCancel={onColumnPointerCancel}
                className={cn(
                  headerCellClass,
                  alignHeader(column.align),
                  "cursor-grab touch-none select-none active:cursor-grabbing",
                  columnDrag?.id === column.id && "cursor-grabbing",
                )}
                style={columnMotionStyle(column.id)}
              >
                {column.id === "name"
                  ? dataMode === "project"
                    ? "Project"
                    : "Task"
                  : column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {groupFields.length === 0 &&
            sortedTasks.map((task) => (
              <tr
                key={task.id}
                onClick={() => onSelectRow(task)}
                className="cursor-pointer border-b border-border transition-colors hover:bg-muted/40"
              >
                {selectCell(task)}
                {renderTaskCells(task, 0)}
              </tr>
            ))}

          {groupFields.length > 0 &&
            nestedGroups.map((group) => {
              /** Renders a grouped row and any nested child groups. */
              const renderNode = (node: GroupNode) => {
                const isCollapsed = !!collapsedGroups[node.key];
                const stickyTop = headerOffset + node.depth * 34;
                const zIndex = 28 - node.depth;

                return (
                  <Fragment key={node.key}>
                    <tr className="border-b border-border">
                      <td
                        colSpan={columns.length + (canSelect ? 1 : 0)}
                        className="px-3 py-2 text-xs font-semibold text-foreground bg-muted sticky"
                        style={{
                          top: `${stickyTop}px`,
                          zIndex,
                        }}
                      >
                        <button
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${node.depth * 14}px` }}
                          onClick={() => toggleGroup(node.key)}
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          {node.color ? (
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: node.color }}
                            />
                          ) : null}
                          <span>{node.label}</span>
                          <span className="text-muted-foreground tabular-nums">
                            ({node.count})
                          </span>
                        </button>
                      </td>
                    </tr>

                    {!isCollapsed &&
                      (node.children.length > 0
                        ? node.children.map((child) => renderNode(child))
                        : node.rows.map((task) => (
                            <tr
                              key={task.id}
                              onClick={() => onSelectRow(task)}
                              className="cursor-pointer border-b border-border transition-colors hover:bg-muted/40"
                            >
                              {selectCell(task)}
                              {renderTaskCells(task, node.depth + 1)}
                            </tr>
                          ))) }
                  </Fragment>
                );
              };

              return renderNode(group);
            })}
        </tbody>
      </table>
      {columnDrag &&
        createPortal(
          <>
            <div
              ref={dropPreviewRef}
              className="pointer-events-none fixed z-40 rounded-md border border-dashed border-primary/70 bg-primary/10 shadow-[inset_3px_0_0_0_var(--primary)] transition-[left,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ opacity: 0 }}
            />
            <div
              ref={ghostRef}
              className="pointer-events-none fixed top-0 left-0 z-50 flex items-center overflow-hidden rounded-md border border-border bg-muted px-3 text-sm font-medium whitespace-nowrap text-foreground shadow-lg"
              style={{ willChange: "transform" }}
            >
              {columnDrag.label}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

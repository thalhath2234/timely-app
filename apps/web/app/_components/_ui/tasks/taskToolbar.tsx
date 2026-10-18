"use client";

import { buttonClass } from "@/app/_components/_ui/button";
import { controlClass, popoverSurface } from "@/app/_components/_ui/field";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, List, ListFilter, X } from "lucide-react";
import { GroupLabel, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import { PopoverView } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";
import Select from "@/app/_components/_ui/select";
import type {
  CustomField,
  Project,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskViewSortBy,
  TaskListSortDirection,
  TaskRenderMode,
  Workspace,
} from "@/app/_types/types";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { GROUP_FIELD_LABELS } from "@timely/contract/taskQuery";
import { useModKey } from "@/app/utils/hooks/useModKey";
import { mergeStatusesByName, statusNameKey } from "@/app/utils/status";
import { plural, pluralWord } from "@/app/utils/plural";

export type TaskListScope = "global" | "project";

// Dates group into buckets (Overdue, Today, This week, ...) by the shared
// engine, so web and phone show the same groups.
const BUCKET_GROUPS: TaskListGroupField[] = [
  "label",
  "deadline",
  "planned",
  "startDate",
  "createdAt",
  "updatedAt",
  "completedAt",
  "effort",
  "done",
  "recurring",
];

const GLOBAL_GROUP_FIELDS: TaskListGroupField[] = [
  "workspace",
  "project",
  "stage",
  "status",
  "priority",
  ...BUCKET_GROUPS,
];

const PROJECT_GROUP_FIELDS: TaskListGroupField[] = ["stage", "status", "priority", ...BUCKET_GROUPS];

const GLOBAL_DEFAULT_GROUPS: TaskListGroupField[] = ["workspace", "project", "stage"];

/**
 * The field a board makes its columns from. The list's default three-level
 * grouping (and a custom field, which has no columns) reads as status
 * columns, without changing the view's saved grouping, so List keeps its
 * groups when the person switches back.
 */
export function boardGroupField(groupFields: TaskListGroupField[], defaults: TaskListGroupField[] = GLOBAL_DEFAULT_GROUPS): TaskListGroupField {
  const first = groupFields[0];
  if (!first || first.startsWith("cf:")) return "status";
  if (groupFields.join(",") === defaults.join(",") && first !== "status") return "status";
  return first;
}

type TaskToolbarProps = {
  viewMode: TaskRenderMode;
  setViewMode: (value: TaskRenderMode) => void;
  groupFields: TaskListGroupField[];
  setGroupFields: (value: TaskListGroupField[]) => void;
  groupSortDirection: TaskListGroupSortDirection;
  setGroupSortDirection: (value: TaskListGroupSortDirection) => void;
  dataMode: TaskListDataMode;
  setDataMode: (value: TaskListDataMode) => void;
  groupValueOrders: Record<string, string[]>;
  setGroupValueOrders: (value: Record<string, string[]>) => void;
  groupOptionsByField: Record<string, string[]>;
  workspaces: Workspace[];
  selectedWorkspaceIds: string[];
  setSelectedWorkspaceIds: (value: string[]) => void;
  selectedStatusIds: string[];
  setSelectedStatusIds: (value: string[]) => void;
  dataCount: number;
  sortBy: TaskViewSortBy;
  setSortBy: (value: TaskViewSortBy) => void;
  sortDirection: TaskListSortDirection;
  setSortDirection: (value: TaskListSortDirection) => void;
  customFields: CustomField[];
  showReminders: boolean;
  setShowReminders: (value: boolean) => void;
  /** Project hub lists are already scoped, so workspace/project tools stay hidden. */
  scope?: TaskListScope;
  defaultGroupFields?: TaskListGroupField[];
  /** Second sort and "show first N"; the Sort panel offers them when set. */
  thenSortBy?: TaskViewSortBy;
  thenSortDirection?: TaskListSortDirection;
  setThenSort?: (by: TaskViewSortBy | undefined, direction: TaskListSortDirection | undefined) => void;
  limit?: number;
  setLimit?: (value: number | undefined) => void;
  /** Drawn at the start of the right-hand group: the describe-the-view box. */
  search?: ReactNode;
  /** Drawn after `search`: the Filters menu button. */
  filters?: ReactNode;
};

export function TaskToolbar({
  viewMode,
  setViewMode,
  groupFields,
  setGroupFields,
  groupSortDirection,
  setGroupSortDirection,
  dataMode,
  setDataMode,
  groupValueOrders,
  setGroupValueOrders,
  groupOptionsByField,
  workspaces,
  selectedWorkspaceIds,
  setSelectedWorkspaceIds,
  selectedStatusIds,
  setSelectedStatusIds,
  dataCount,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  customFields,
  showReminders,
  setShowReminders,
  scope = "global",
  defaultGroupFields,
  thenSortBy,
  thenSortDirection,
  setThenSort,
  limit,
  setLimit,
  search,
  filters,
}: TaskToolbarProps) {
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupSortPanelOpen, setGroupSortPanelOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null);
  const [dragGroupValue, setDragGroupValue] = useState<{
    field: TaskListGroupField;
    index: number;
  } | null>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const groupSortPanelRef = useRef<HTMLDivElement>(null);
  const workspacePanelRef = useRef<HTMLDivElement>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  const isProjectScope = scope === "project";

  useEffect(() => {
    const isInsideSelectPortal = (event: Event) =>
      event.composedPath().some(
        (node) => node instanceof Element && node.matches("[data-select-portal='true']"),
      );

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (isInsideSelectPortal(event)) return;

      if (groupPanelOpen && groupPanelRef.current && !groupPanelRef.current.contains(target)) {
        setGroupPanelOpen(false);
      }

      if (
        groupSortPanelOpen &&
        groupSortPanelRef.current &&
        !groupSortPanelRef.current.contains(target)
      ) {
        setGroupSortPanelOpen(false);
      }

      if (
        workspacePanelOpen &&
        workspacePanelRef.current &&
        !workspacePanelRef.current.contains(target)
      ) {
        setWorkspacePanelOpen(false);
      }

      if (statusPanelOpen && statusPanelRef.current && !statusPanelRef.current.contains(target)) {
        setStatusPanelOpen(false);
      }

      if (sortPanelOpen && sortPanelRef.current && !sortPanelRef.current.contains(target)) {
        setSortPanelOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGroupPanelOpen(false);
        setGroupSortPanelOpen(false);
        setWorkspacePanelOpen(false);
        setStatusPanelOpen(false);
        setSortPanelOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [groupPanelOpen, groupSortPanelOpen, workspacePanelOpen, statusPanelOpen, sortPanelOpen]);

  const availableGroups: TaskListGroupField[] = [
    ...(isProjectScope ? PROJECT_GROUP_FIELDS : GLOBAL_GROUP_FIELDS),
    ...(viewMode === "kanban" ? [] : customFields.map((field) => `cf:${field.id}` as TaskListGroupField)),
  ];

  const resetGroupFields = defaultGroupFields ?? (isProjectScope ? ["status"] : GLOBAL_DEFAULT_GROUPS);
  const currentGroups: TaskListGroupField[] = groupFields.slice(0, 3);

  const updateGroupField = (index: number, value: TaskListGroupField | "none") => {
    const next = [...currentGroups];
    if (value === "none") {
      next.splice(index, 1);
    } else {
      next[index] = value;
    }

    const normalized = next.filter(Boolean).slice(0, 3);
    setGroupFields(normalized);
  };

  const addGroupField = () => {
    if (currentGroups.length >= 3) return;
    const next = availableGroups.find((field) => !currentGroups.includes(field));
    if (!next) return;
    setGroupFields([...currentGroups, next]);
  };

  const resetGroups = () => {
    setGroupFields(resetGroupFields);
    setGroupSortDirection("asc");
    setGroupValueOrders({});
  };

  const reorderGroups = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= currentGroups.length || to >= currentGroups.length) {
      return;
    }
    const next = [...currentGroups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroupFields(next);
  };

  const reorderGroupValues = (field: TaskListGroupField, from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const base = groupOptionsByField[field] ?? [];
    const current = groupValueOrders[field] ?? base;
    if (from >= current.length || to >= current.length) return;

    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    setGroupValueOrders({
      ...groupValueOrders,
      [field]: next,
    });
  };

  const groupLabel = (value: TaskListGroupField) => {
    if (value.startsWith("cf:")) {
      const field = customFields.find((item) => item.id === value.slice(3));
      return field?.name ?? "Custom Field";
    }
    return GROUP_FIELD_LABELS[value] ?? value[0].toUpperCase() + value.slice(1);
  };

  const toggleWorkspace = (workspaceId: string) => {
    if (selectedWorkspaceIds.includes(workspaceId)) {
      setSelectedWorkspaceIds(selectedWorkspaceIds.filter((id) => id !== workspaceId));
      return;
    }
    setSelectedWorkspaceIds([...selectedWorkspaceIds, workspaceId]);
  };

  const scopedWorkspaces =
    selectedWorkspaceIds.length === 0
      ? workspaces
      : workspaces.filter((workspace) => selectedWorkspaceIds.includes(workspace.id));

  const statusCatalog = scopedWorkspaces.flatMap((workspace) => workspace.status ?? []);
  const statusGroups = mergeStatusesByName(statusCatalog);

  const toggleStatusGroup = (key: string) => {
    const idsForName = statusCatalog
      .filter((status) => statusNameKey(status.name) === key)
      .map((status) => status.id);
    const allIds = statusCatalog.map((status) => status.id);
    const current = selectedStatusIds.length === 0 ? allIds : selectedStatusIds;
    const selected = new Set(current);
    const allSelected = idsForName.length > 0 && idsForName.every((id) => selected.has(id));
    const next = allSelected
      ? current.filter((id) => !idsForName.includes(id))
      : [...new Set([...current, ...idsForName])];

    setSelectedStatusIds(next.length === 0 || next.length === allIds.length ? [] : next);
  };

  const sortOptions = [
    { value: "name", label: "Name" },
    { value: "deadline", label: "Deadline" },
    { value: "scheduledOn", label: "Scheduled date" },
    { value: "startDate", label: "Start date" },
    { value: "createdAt", label: "Created at" },
    { value: "updatedAt", label: "Last updated" },
    { value: "completedAt", label: "Completed at" },
    { value: "priority", label: "Priority" },
    { value: "urgency", label: "Urgency" },
    { value: "status", label: "Status" },
    { value: "stage", label: "Stage" },
    ...(isProjectScope ? [] : [{ value: "project", label: "Project" }, { value: "workspace", label: "Workspace" }]),
    { value: "duration", label: "Duration" },
    { value: "tracked", label: "Time tracked" },
    { value: "progress", label: "Checklist progress" },
    { value: "effort", label: "Effort" },
    ...customFields.map((field) => ({ value: `cf:${field.id}`, label: field.name })),
  ];

  const sortName = (value: TaskViewSortBy) => sortOptions.find((option) => option.value === value)?.label ?? "Deadline";
  const directionOptions: { value: TaskListSortDirection; label: string; title: string }[] = [
    { value: "asc", label: "Asc", title: "Ascending: A to Z, soonest, lowest first" },
    { value: "desc", label: "Desc", title: "Descending: Z to A, latest, highest first" },
  ];

  const dataModeOptions = [
    { value: "task", label: "Tasks" },
    { value: "reminder", label: "Reminders" },
    ...(isProjectScope ? [] : [{ value: "project", label: "Projects" }]),
  ];

  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-y-2 border-b border-border px-6 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={groupPanelRef}>
          <button
            type="button"
            className={buttonClass({ variant: "outline", size: "sm", className: "font-normal" })}
            aria-expanded={groupPanelOpen}
            onClick={() => setGroupPanelOpen((prev) => !prev)}
          >
            <span className="text-muted-foreground">Group</span>
            <span className="font-medium text-foreground">
              {viewMode === "kanban"
                ? groupLabel(boardGroupField(currentGroups, resetGroupFields))
                : currentGroups.length
                  ? currentGroups.map(groupLabel).join(" › ")
                  : "None"}
            </span>
            <ChevronDown className="text-muted-foreground" />
          </button>

          {groupPanelOpen && (
            <div className="absolute top-9 left-0 z-40 w-[320px] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Groups</h4>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={resetGroups}>
                  Reset
                </button>
              </div>

              <div className="space-y-2">
                {currentGroups.map((value, index) => (
                  <div
                    key={`group-field-${index}`}
                    className="flex items-center gap-2"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragGroupIndex !== null) {
                        reorderGroups(dragGroupIndex, index);
                      }
                      setDragGroupIndex(null);
                    }}
                  >
                    <span
                      className="cursor-grab text-muted-foreground active:cursor-grabbing"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragGroupIndex(index);
                      }}
                      onDragEnd={() => setDragGroupIndex(null)}
                    >
                      <GripVertical size={14} />
                    </span>

                    <div className="flex-1">
                      <Select
                        size="sm"
                        aria-label={`Group level ${index + 1}`}
                        value={value}
                        onChange={(next) => updateGroupField(index, next as TaskListGroupField | "none")}
                        options={availableGroups.map((option) => ({
                          value: option,
                          label: groupLabel(option),
                          disabled: option !== value && currentGroups.includes(option),
                        }))}
                      />
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove ${groupLabel(value)} grouping`}
                      title={`Remove ${groupLabel(value)} grouping`}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => updateGroupField(index, "none")}
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                  disabled={currentGroups.length >= 3}
                  onClick={addGroupField}
                >
                  + Add Group ({currentGroups.length}/3)
                </button>

                <button
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                  onClick={() => setGroupSortDirection(groupSortDirection === "asc" ? "desc" : "asc")}
                >
                  Sort {groupSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <label className="mb-1 block text-xs text-muted-foreground">Data</label>
                <Select
                  size="sm"
                  value={showReminders ? "reminder" : dataMode}
                  onChange={(next) => {
                    if (next === "reminder") {
                      setShowReminders(true);
                      setDataMode("task");
                      return;
                    }
                    setShowReminders(false);
                    setDataMode(next as TaskListDataMode);
                  }}
                  options={dataModeOptions}
                />
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={groupSortPanelRef}>
          <button
            type="button"
            className={buttonClass({ variant: "ghost", size: "sm" })}
            aria-expanded={groupSortPanelOpen}
            onClick={() => setGroupSortPanelOpen((prev) => !prev)}
          >
            Order groups
          </button>

          {groupSortPanelOpen && (
            <div className="absolute top-9 left-0 z-40 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
              <div className="flex">
                {currentGroups.map((field) => {
                  const values = groupValueOrders[field] ?? groupOptionsByField[field] ?? [];
                  return (
                    <div key={`sort-field-${field}`} className="w-60 border-r border-border last:border-r-0">
                      <div className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
                        {groupLabel(field)}
                      </div>

                      <div className="max-h-64 space-y-1 overflow-auto p-2">
                        {values.map((value, index) => (
                          <div
                            key={`${field}-${value}`}
                            className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5"
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              setDragGroupValue({ field, index });
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (dragGroupValue && dragGroupValue.field === field) {
                                reorderGroupValues(field, dragGroupValue.index, index);
                              }
                              setDragGroupValue(null);
                            }}
                            onDragEnd={() => setDragGroupValue(null)}
                          >
                            <span className="cursor-grab text-muted-foreground active:cursor-grabbing">
                              <GripVertical size={14} />
                            </span>
                            <span className="flex-1 truncate text-sm text-foreground">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <SegmentedControl
          size="sm"
          aria-label="Layout"
          value={viewMode}
          onChange={(next) => {
            if (next === "kanban" && groupFields[0]?.startsWith("cf:")) setGroupFields(["status"]);
            setViewMode(next);
          }}
          options={[
            { value: "list", label: "List", icon: <List /> },
            { value: "kanban", label: "Kanban" },
            { value: "gantt", label: "Gantt" },
          ]}
        />

        <div className="relative" ref={sortPanelRef}>
          <button
            type="button"
            className={buttonClass({ variant: "outline", size: "sm", className: "max-w-80 font-normal" })}
            aria-expanded={sortPanelOpen}
            onClick={() => setSortPanelOpen((prev) => !prev)}
          >
            <span className="text-muted-foreground">Sort</span>
            <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground">
              <span className="truncate">{sortName(sortBy)}</span>
              {sortDirection === "desc" ? <ArrowDown aria-label="descending" /> : <ArrowUp aria-label="ascending" />}
              {thenSortBy ? <span className="truncate text-muted-foreground">then {sortName(thenSortBy)}</span> : null}
              {limit ? <span className="shrink-0 text-muted-foreground">· first {limit}</span> : null}
            </span>
            <ChevronDown className="text-muted-foreground" />
          </button>

          {sortPanelOpen && (
            <div className="absolute top-9 left-0 z-40 w-[300px] space-y-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Sort by</h4>
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <Select
                      size="sm"
                      searchable
                      value={sortBy}
                      onChange={(next) => setSortBy(next as TaskViewSortBy)}
                      options={sortOptions}
                      aria-label="Sort by"
                    />
                  </div>
                  <SegmentedControl
                    size="sm"
                    aria-label="Sort direction"
                    value={sortDirection}
                    onChange={setSortDirection}
                    options={directionOptions}
                  />
                </div>
              </div>
              {setThenSort ? (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-medium text-muted-foreground">Then by</h4>
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <Select
                        size="sm"
                        searchable
                        value={thenSortBy ?? ""}
                        onChange={(next) =>
                          next ? setThenSort(next as TaskViewSortBy, thenSortDirection ?? "asc") : setThenSort(undefined, undefined)
                        }
                        options={[
                          { value: "", label: "Nothing" },
                          ...sortOptions.filter((option) => option.value !== sortBy),
                        ]}
                        aria-label="Then sort by"
                      />
                    </div>
                    {thenSortBy ? (
                      <SegmentedControl
                        size="sm"
                        aria-label="Second sort direction"
                        value={thenSortDirection ?? "asc"}
                        onChange={(next) => setThenSort(thenSortBy, next)}
                        options={directionOptions}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
              {setLimit ? (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <h4 className="text-xs font-medium text-muted-foreground">Show</h4>
                  <div className="flex items-center gap-1.5">
                    <SegmentedControl
                      size="sm"
                      aria-label="How many to show"
                      value={limit ? "first" : "all"}
                      onChange={(next) => setLimit(next === "first" ? (limit ?? 10) : undefined)}
                      options={[
                        { value: "all", label: "All" },
                        { value: "first", label: "First" },
                      ]}
                    />
                    {limit ? <LimitInput value={limit} onChange={setLimit} /> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {search}
        {filters}
        <div className="relative" ref={statusPanelRef}>
          <button
            type="button"
            className={buttonClass({ variant: "outline", size: "sm", className: "font-normal" })}
            aria-expanded={statusPanelOpen}
            onClick={() => setStatusPanelOpen((prev) => !prev)}
          >
            <span className="text-muted-foreground">Status</span>
              <span className="font-medium text-foreground">
              {selectedStatusIds.length === 0
                ? "All"
                : (() => {
                    const selectedGroups = mergeStatusesByName(
                      statusCatalog.filter((status) => selectedStatusIds.includes(status.id)),
                    );
                    return selectedGroups.length === 1
                      ? selectedGroups[0].name
                      : `${selectedGroups.length} selected`;
                  })()}
            </span>
            <ChevronDown className="text-muted-foreground" />
          </button>

          {statusPanelOpen && (
            <div className="absolute top-9 right-0 z-40 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Statuses</h4>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedStatusIds([])}
                >
                  All
                </button>
              </div>

              <div className="max-h-56 space-y-1 overflow-auto">
                {statusGroups.map((group) => {
                  const idsForName = group.statuses.map((status) => status.id);
                  const current =
                    selectedStatusIds.length === 0
                      ? statusCatalog.map((status) => status.id)
                      : selectedStatusIds;
                  const checked = idsForName.every((id) => current.includes(id));

                  return (
                    <label
                      key={group.key}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStatusGroup(group.key)}
                        className="accent-primary"
                      />
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                      <span className="truncate text-sm text-foreground">{group.name}</span>
                    </label>
                  );
                })}

                {statusGroups.length === 0 && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">No statuses found</div>
                )}
              </div>
            </div>
          )}
        </div>

        {!isProjectScope ? (
          <div className="relative" ref={workspacePanelRef}>
            <button
              type="button"
              className={buttonClass({ variant: "outline", size: "sm", className: "font-normal" })}
              aria-expanded={workspacePanelOpen}
              onClick={() => setWorkspacePanelOpen((prev) => !prev)}
            >
              <span className="text-muted-foreground">Workspace</span>
              <span className="font-medium text-foreground">
                {selectedWorkspaceIds.length === 0
                  ? "All"
                  : selectedWorkspaceIds.length === 1
                    ? (workspaces.find((item) => item.id === selectedWorkspaceIds[0])?.name ?? "Selected")
                    : `${selectedWorkspaceIds.length} selected`}
              </span>
              <ChevronDown className="text-muted-foreground" />
            </button>

            {workspacePanelOpen && (
              <div className="absolute top-9 right-0 z-40 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Workspaces</h4>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedWorkspaceIds([])}
                  >
                    All
                  </button>
                </div>

                <div className="max-h-56 space-y-1 overflow-auto">
                  {workspaces.map((workspace) => {
                    const checked = selectedWorkspaceIds.includes(workspace.id);
                    return (
                      <label
                        key={workspace.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWorkspace(workspace.id)}
                          className="accent-primary"
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: workspace.color || "var(--muted-foreground)",
                          }}
                        />
                        <span className="text-sm text-foreground">{workspace.name}</span>
                      </label>
                    );
                  })}

                  {workspaces.length === 0 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No workspaces found</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <span className="text-xs tabular-nums text-muted-foreground">
          {plural(dataCount, dataMode === "task" ? (showReminders ? "reminder" : "task") : "project")}
        </span>
      </div>
    </div>
  );
}

/** "Show first N": saves on Enter or blur, between 1 and 500. */
function LimitInput({ value, onChange }: { value: number; onChange: (value: number | undefined) => void }) {
  const [draft, setDraft] = useState({ from: value, text: String(value) });
  const text = draft.from === value ? draft.text : String(value);
  const commit = () => {
    const number = Math.round(Number(text));
    if (Number.isFinite(number) && number >= 1) onChange(Math.min(number, 500));
    else setDraft({ from: value, text: String(value) });
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={500}
        inputMode="numeric"
        value={text}
        onChange={(event) => setDraft({ from: value, text: event.target.value })}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        aria-label="Number of tasks to show"
        className={controlClass("sm", "w-16")}
      />
      <span className="text-xs text-muted-foreground">after sorting</span>
    </div>
  );
}

export function TaskOptionsBar({
  showCompleted,
  setShowCompleted,
  onlyOverdue,
  setOnlyOverdue,
  onlyScheduled,
  setOnlyScheduled,
  onlyRecurring,
  setOnlyRecurring,
  onlyDated,
  setOnlyDated,
  projects,
  workspaces,
  selectedProjectIds,
  setSelectedProjectIds,
  selectedPriorityLevels,
  setSelectedPriorityLevels,
  selectedLabelIds,
  setSelectedLabelIds,
  selectedStageIds,
  setSelectedStageIds,
  scope = "global",
  layout = "bar",
  footer,
}: {
  showCompleted: boolean;
  setShowCompleted: (value: boolean) => void;
  onlyOverdue: boolean;
  setOnlyOverdue: (value: boolean) => void;
  onlyScheduled: boolean;
  setOnlyScheduled: (value: boolean) => void;
  onlyRecurring: boolean;
  setOnlyRecurring: (value: boolean) => void;
  onlyDated: boolean;
  setOnlyDated: (value: boolean) => void;
  projects: Project[];
  workspaces: Workspace[];
  selectedProjectIds: string[];
  setSelectedProjectIds: (value: string[]) => void;
  selectedPriorityLevels: string[];
  setSelectedPriorityLevels: (value: string[]) => void;
  selectedLabelIds: string[];
  setSelectedLabelIds: (value: string[]) => void;
  selectedStageIds: string[];
  setSelectedStageIds: (value: string[]) => void;
  scope?: TaskListScope;
  /** "panel": grouped rows for the Filters menu instead of a bar of controls. */
  layout?: "bar" | "panel";
  /** Panel only: drawn under the groups (the Add filter button). */
  footer?: ReactNode;
}) {
  const isProjectScope = scope === "project";
  const labels = workspaces.flatMap((workspace) => workspace.lables ?? []);
  const stages = projects.flatMap((project) =>
    (project.stages ?? []).map((stage) => ({
      id: stage.id,
      label: isProjectScope ? stage.name : `${project.title}: ${stage.name}`,
      color: stage.color ?? undefined,
    })),
  );

  if (layout === "panel") {
    const togglePriority = (level: string) =>
      setSelectedPriorityLevels(
        selectedPriorityLevels.includes(level)
          ? selectedPriorityLevels.filter((item) => item !== level)
          : [...selectedPriorityLevels, level],
      );
    return (
      <div className="w-80 p-3 text-xs" data-testid="task-filters-panel">
        <GroupLabel>Show</GroupLabel>
        <ListGroup>
          <ListRow label="Completed tasks">
            <ListSwitch label="Show completed tasks" checked={showCompleted} onChange={setShowCompleted} />
          </ListRow>
          <ListRow label="Only overdue">
            <ListSwitch label="Only overdue" checked={onlyOverdue} onChange={setOnlyOverdue} />
          </ListRow>
          <ListRow label="Only scheduled">
            <ListSwitch label="Only scheduled" checked={onlyScheduled} onChange={setOnlyScheduled} />
          </ListRow>
          <ListRow label="Only repeating">
            <ListSwitch label="Only repeating" checked={onlyRecurring} onChange={setOnlyRecurring} />
          </ListRow>
          <ListRow label="Only dated" meta="A deadline or reserved time">
            <ListSwitch label="Only dated" checked={onlyDated} onChange={setOnlyDated} />
          </ListRow>
        </ListGroup>
        <GroupLabel className="mt-3">Narrow to</GroupLabel>
        <ListGroup>
          {!isProjectScope ? (
            <ListRow label="Project">
              <Select
                variant="row"
                size="sm"
                aria-label="Project"
                value={selectedProjectIds[0] ?? ""}
                placeholder="All"
                onChange={(projectId) => setSelectedProjectIds(projectId ? [projectId] : [])}
                options={[
                  { value: "", label: "All projects" },
                  ...projects.map((project) => ({ value: project.id, label: project.title, color: project.color ?? undefined })),
                ]}
              />
            </ListRow>
          ) : null}
          <ListRow label="Priority">
            <Select
              variant="row"
              size="sm"
              aria-label="Priority"
              values={selectedPriorityLevels}
              value={selectedPriorityLevels[0] ?? ""}
              placeholder="All"
              onChange={togglePriority}
              options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
          </ListRow>
          {labels.length > 0 ? (
            <ListRow label="Label">
              <Select
                variant="row"
                size="sm"
                aria-label="Label"
                value={selectedLabelIds[0] ?? ""}
                placeholder="All"
                onChange={(labelId) => setSelectedLabelIds(labelId ? [labelId] : [])}
                options={[{ value: "", label: "All labels" }, ...labels.map((label) => ({ value: label.id, label: label.name, color: label.color }))]}
              />
            </ListRow>
          ) : null}
          {stages.length > 0 ? (
            <ListRow label="Stage">
              <Select
                variant="row"
                size="sm"
                aria-label="Stage"
                value={selectedStageIds[0] ?? ""}
                placeholder="All"
                onChange={(stageId) => setSelectedStageIds(stageId ? [stageId] : [])}
                options={[{ value: "", label: "All stages" }, ...stages.map((stage) => ({ value: stage.id, label: stage.label, color: stage.color }))]}
              />
            </ListRow>
          ) : null}
        </ListGroup>
        {footer ? <div className="mt-3 flex items-center justify-between gap-2">{footer}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="size-3.5 rounded border-border accent-primary"
          checked={onlyOverdue}
          onChange={(event) => setOnlyOverdue(event.target.checked)}
        />
        Overdue
      </label>
      <label
        className={`flex items-center gap-1.5 ${
          showCompleted ? "text-foreground" : ""
        }`}
      >
        <input
          type="checkbox"
          className="size-3.5 rounded border-border accent-primary"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
        />
        Show completed
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="size-3.5 rounded border-border accent-primary"
          checked={onlyScheduled}
          onChange={(event) => setOnlyScheduled(event.target.checked)}
        />
        Scheduled
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="size-3.5 rounded border-border accent-primary"
          checked={onlyRecurring}
          onChange={(event) => setOnlyRecurring(event.target.checked)}
        />
        Recurring
      </label>
      <label
        className="flex items-center gap-1.5"
        title="Only tasks with a deadline or reserved calendar time"
      >
        <input
          type="checkbox"
          className="size-3.5 rounded border-border accent-primary"
          checked={onlyDated}
          onChange={(event) => setOnlyDated(event.target.checked)}
        />
        Dated only
      </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
      {!isProjectScope ? (
        <div className="w-40">
          <Select
            size="sm"
            value={selectedProjectIds[0] ?? ""}
            placeholder="Project"
            onChange={(projectId) => setSelectedProjectIds(projectId ? [projectId] : [])}
            options={[
              { value: "", label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.title,
                color: project.color ?? undefined,
              })),
            ]}
          />
        </div>
      ) : null}
      <PriorityFilter value={selectedPriorityLevels} onChange={setSelectedPriorityLevels} />
      {labels.length > 0 ? (
        <div className="w-36">
          <Select
            size="sm"
            value={selectedLabelIds[0] ?? ""}
            placeholder="Label"
            onChange={(labelId) => setSelectedLabelIds(labelId ? [labelId] : [])}
            options={[
              { value: "", label: "All labels" },
              ...labels.map((label) => ({ value: label.id, label: label.name, color: label.color })),
            ]}
          />
        </div>
      ) : null}
      {stages.length > 0 ? (
        <div className="w-44">
          <Select
            size="sm"
            value={selectedStageIds[0] ?? ""}
            placeholder="Stage"
            onChange={(stageId) => setSelectedStageIds(stageId ? [stageId] : [])}
            options={[
              { value: "", label: "All stages" },
              ...stages.map((stage) => ({
                value: stage.id,
                label: stage.label,
                color: stage.color,
              })),
            ]}
          />
        </div>
      ) : null}
      </div>
    </div>
  );
}

/** How many of the options bar's switches and picks are away from their defaults. */
export function countActiveOptions(options: {
  showCompleted: boolean;
  onlyOverdue: boolean;
  onlyScheduled: boolean;
  onlyRecurring: boolean;
  onlyDated: boolean;
  selectedProjectIds?: string[];
  selectedPriorityLevels: string[];
  selectedLabelIds: string[];
  selectedStageIds: string[];
}): number {
  return [
    !options.showCompleted,
    options.onlyOverdue,
    options.onlyScheduled,
    options.onlyRecurring,
    options.onlyDated,
    (options.selectedProjectIds?.length ?? 0) > 0,
    options.selectedPriorityLevels.length > 0,
    options.selectedLabelIds.length > 0,
    options.selectedStageIds.length > 0,
  ].filter(Boolean).length;
}

/**
 * The Filters button on the toolbar line: a count of options in use, and a
 * popover holding the options panel. It closes on an outside click, except
 * inside a Select's portal or a rule editor, and on Escape.
 */
export function FiltersMenu({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (event: Event) =>
      event
        .composedPath()
        .some((node) => node instanceof Element && (node === rootRef.current || node.matches("[data-select-portal='true']") || node.matches("[data-rule-popover]")));
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!inside(event)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef} data-rule-popover>
      <button
        type="button"
        className={buttonClass({ variant: count ? "secondary" : "outline", size: "sm", className: "font-normal" })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((previous) => !previous)}
      >
        <ListFilter className="text-muted-foreground" aria-hidden />
        <span className={cn(count ? "font-medium text-foreground" : "text-foreground")}>Filters</span>
        {count ? (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">{count}</span>
        ) : null}
        <ChevronDown className="text-muted-foreground" />
      </button>
      {open ? (
        <PopoverView>
          <div role="dialog" aria-label="Filters" className={cn(popoverSurface, "absolute top-9 right-0 z-40")}>
            {children}
          </div>
        </PopoverView>
      ) : null}
    </div>
  );
}

export function TaskListStatusBar({
  shown,
  total,
  synced = true,
  noun = "task",
}: {
  shown: number;
  total: number;
  synced?: boolean;
  /** Singular; the bar adds the plural ending. */
  noun?: string;
}) {
  const modKey = useModKey();
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-6 py-2 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${synced ? "bg-success" : "bg-warning"}`} />
          {synced ? "All local changes synced" : "View changes waiting to sync"}
        </span>
        <span className="text-border">·</span>
        <span>
          Showing {shown}
          {total !== shown ? ` of ${total}` : ""} {pluralWord(total !== shown ? total : shown, noun)}
        </span>
      </div>
      <div className="hidden items-center gap-3 sm:flex">
        <span className="inline-flex items-center gap-1.5">
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-foreground">
            {modKey}+K
          </kbd>
          Quick search
        </span>
      </div>
    </footer>
  );
}

/**
 * Priority filter: several levels can be ticked at once, so it is a small
 * popover rather than the single-choice kit Select. Like the Select it closes
 * on an outside click (which includes switching to Gantt) and on Escape.
 */
function PriorityFilter({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label =
    value.length === 0 ? "All priorities" : value.length === 1 ? value[0] : `${value.length} priorities`;

  return (
    <div ref={rootRef} className="relative w-36">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Priority: ${label}`}
        onClick={() => setOpen((current) => !current)}
        className={controlClass("sm", "flex w-full cursor-pointer items-center justify-between gap-2")}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <div className={`${popoverSurface} absolute right-0 top-full z-40 mt-1 w-44 p-1`}>
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full rounded px-2 py-1 text-left hover:bg-accent"
          >
            All priorities
          </button>
          {PRIORITY_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent">
              <input
                type="checkbox"
                checked={value.includes(option.value)}
                onChange={() =>
                  onChange(
                    value.includes(option.value)
                      ? value.filter((level) => level !== option.value)
                      : [...value, option.value],
                  )
                }
                className="accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

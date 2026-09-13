"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Config,
  Project,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortBy,
  TaskListSortDirection,
  TaskRenderMode,
  TaskViewConfig,
} from "@/app/_types/types";
import { ApiError } from "@/app/utils/api/worksapce";
import { useConfig, useUpdateTaskViewsConfig } from "@/app/utils/hooks/workspaces";
import { resolveViewOnlyDated, resolveViewShowCompleted } from "@/app/utils/taskFilters";

const PROJECT_GROUP_FIELDS = new Set<string>(["stage", "status", "priority"]);

const areStringArraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const areRecordsOfStringArraysEqual = (
  a: Record<string, string[]>,
  b: Record<string, string[]>,
) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => areStringArraysEqual(a[key] ?? [], b[key] ?? []));
};

export function defaultProjectGroupFields(project: Project): TaskListGroupField[] {
  return project.doesHaveStages && (project.stages?.length ?? 0) > 0 ? ["stage"] : ["status"];
}

function sanitizeProjectGroupFields(
  fields: TaskListGroupField[] | undefined,
  fallback: TaskListGroupField[],
): TaskListGroupField[] {
  const next = (fields ?? [])
    .filter((field) => PROJECT_GROUP_FIELDS.has(field) || field.startsWith("cf:"))
    .slice(0, 3);
  return next.length > 0 ? next : fallback;
}

function sanitizeSortBy(sortBy: TaskListSortBy | undefined): TaskListSortBy {
  return sortBy && sortBy !== "project" ? sortBy : "deadline";
}

function viewNameFor(project: Project): string {
  const title = project.title.trim();
  if (!title) return "Project";
  return title.length > 100 ? title.slice(0, 100) : title;
}

function viewsEqual(a: TaskViewConfig, b: TaskViewConfig): boolean {
  return (
    a.renderMode === b.renderMode &&
    a.groupSortDirection === b.groupSortDirection &&
    a.dataMode === b.dataMode &&
    a.sortBy === b.sortBy &&
    a.sortDirection === b.sortDirection &&
    Boolean(a.showCompleted) === Boolean(b.showCompleted) &&
    Boolean(a.onlyOverdue) === Boolean(b.onlyOverdue) &&
    Boolean(a.onlyScheduled) === Boolean(b.onlyScheduled) &&
    Boolean(a.onlyRecurring) === Boolean(b.onlyRecurring) &&
    Boolean(a.onlyDated) === Boolean(b.onlyDated) &&
    Boolean(a.showReminders) === Boolean(b.showReminders) &&
    Boolean(a.optionsVisible ?? true) === Boolean(b.optionsVisible ?? true) &&
    areStringArraysEqual(a.groupFields, b.groupFields) &&
    areStringArraysEqual(a.selectedStatusIds ?? [], b.selectedStatusIds ?? []) &&
    areStringArraysEqual(a.selectedPriorityLevels ?? [], b.selectedPriorityLevels ?? []) &&
    areStringArraysEqual(a.selectedLabelIds ?? [], b.selectedLabelIds ?? []) &&
    areStringArraysEqual(a.selectedStageIds ?? [], b.selectedStageIds ?? []) &&
    areStringArraysEqual(a.columnOrder ?? [], b.columnOrder ?? []) &&
    areRecordsOfStringArraysEqual(a.groupValueOrders ?? {}, b.groupValueOrders ?? {})
  );
}

export function usePersistedProjectTaskView(project: Project) {
  const queryClient = useQueryClient();
  const configQuery = useConfig();
  const { mutate: saveViews } = useUpdateTaskViewsConfig();
  const typedConfig = configQuery.data as Config | undefined;
  const defaultGroups = useMemo(() => defaultProjectGroupFields(project), [project]);

  const [viewMode, setViewMode] = useState<TaskRenderMode>("list");
  const [groupFields, setGroupFields] = useState<TaskListGroupField[]>(defaultGroups);
  const [groupSortDirection, setGroupSortDirection] =
    useState<TaskListGroupSortDirection>("asc");
  const [dataMode, setDataMode] = useState<TaskListDataMode>("task");
  const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>([]);
  const [selectedPriorityLevels, setSelectedPriorityLevels] = useState<string[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [showCompleted, setShowCompleted] = useState(true);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyScheduled, setOnlyScheduled] = useState(false);
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const [onlyDated, setOnlyDated] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [groupValueOrders, setGroupValueOrders] = useState<Record<string, string[]>>({});
  const [sortBy, setSortBy] = useState<TaskListSortBy>("deadline");
  const [sortDirection, setSortDirection] = useState<TaskListSortDirection>("asc");
  const [optionsVisible, setOptionsVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState("");
  const hydratingRef = useRef(false);

  const savedView = typedConfig?.projectTaskViews?.[project.id];

  const snapshot = useMemo((): TaskViewConfig => {
    return {
      id: project.id,
      name: viewNameFor(project),
      dataMode: "task",
      renderMode: viewMode,
      groupFields: sanitizeProjectGroupFields(groupFields, defaultGroups),
      groupSortDirection,
      groupValueOrders,
      sortBy: sanitizeSortBy(sortBy),
      sortDirection,
      selectedWorkspaceIds: [],
      selectedStatusIds,
      selectedProjectIds: [],
      selectedPriorityLevels,
      selectedLabelIds,
      selectedStageIds,
      showCompleted,
      onlyOverdue,
      onlyScheduled,
      onlyRecurring,
      onlyDated,
      showReminders,
      columnOrder,
      optionsVisible,
    };
  }, [
    project,
    viewMode,
    groupFields,
    defaultGroups,
    groupSortDirection,
    groupValueOrders,
    sortBy,
    sortDirection,
    selectedStatusIds,
    selectedPriorityLevels,
    selectedLabelIds,
    selectedStageIds,
    showCompleted,
    onlyOverdue,
    onlyScheduled,
    onlyRecurring,
    onlyDated,
    showReminders,
    columnOrder,
    optionsVisible,
  ]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!typedConfig) return;

    hydratingRef.current = true;
    const next = typedConfig.projectTaskViews?.[project.id];
    if (next) {
      setViewMode((previous) => (previous === next.renderMode ? previous : next.renderMode));
      setGroupFields((previous) => {
        const fields = sanitizeProjectGroupFields(next.groupFields, defaultGroups);
        return areStringArraysEqual(previous, fields) ? previous : fields;
      });
      setGroupSortDirection((previous) =>
        previous === next.groupSortDirection ? previous : next.groupSortDirection,
      );
      setDataMode("task");
      setSelectedStatusIds((previous) => {
        const ids = next.selectedStatusIds ?? [];
        return areStringArraysEqual(previous, ids) ? previous : ids;
      });
      setSelectedPriorityLevels((previous) => {
        const ids = next.selectedPriorityLevels ?? [];
        return areStringArraysEqual(previous, ids) ? previous : ids;
      });
      setSelectedLabelIds((previous) => {
        const ids = next.selectedLabelIds ?? [];
        return areStringArraysEqual(previous, ids) ? previous : ids;
      });
      setSelectedStageIds((previous) => {
        const ids = next.selectedStageIds ?? [];
        return areStringArraysEqual(previous, ids) ? previous : ids;
      });
      setShowCompleted(resolveViewShowCompleted(next));
      setOnlyOverdue(Boolean(next.onlyOverdue));
      setOnlyScheduled(Boolean(next.onlyScheduled));
      setOnlyRecurring(Boolean(next.onlyRecurring));
      setOnlyDated(resolveViewOnlyDated(next));
      setShowReminders(Boolean(next.showReminders));
      setColumnOrder((previous) => {
        const order = next.columnOrder ?? [];
        return areStringArraysEqual(previous, order) ? previous : order;
      });
      setGroupValueOrders((previous) =>
        areRecordsOfStringArraysEqual(previous, next.groupValueOrders ?? {})
          ? previous
          : (next.groupValueOrders ?? {}),
      );
      setSortBy((previous) => {
        const nextSort = sanitizeSortBy(next.sortBy);
        return previous === nextSort ? previous : nextSort;
      });
      setSortDirection((previous) =>
        previous === next.sortDirection ? previous : next.sortDirection,
      );
      setOptionsVisible(next.optionsVisible ?? true);
    } else {
      setViewMode("list");
      setGroupFields(defaultGroups);
      setGroupSortDirection("asc");
      setDataMode("task");
      setSelectedStatusIds([]);
      setSelectedPriorityLevels([]);
      setSelectedLabelIds([]);
      setSelectedStageIds([]);
      setShowCompleted(true);
      setOnlyOverdue(false);
      setOnlyScheduled(false);
      setOnlyRecurring(false);
      setOnlyDated(false);
      setShowReminders(false);
      setColumnOrder([]);
      setGroupValueOrders({});
      setSortBy("deadline");
      setSortDirection("asc");
      setOptionsVisible(true);
    }

    setReady(true);
    const timer = setTimeout(() => {
      hydratingRef.current = false;
    }, 0);
    return () => {
      clearTimeout(timer);
      hydratingRef.current = false;
    };
  }, [typedConfig?.id, project.id, savedView, defaultGroups, typedConfig]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready || !typedConfig || hydratingRef.current) return;
    if (!typedConfig.taskViews?.length) return;

    const current = typedConfig.projectTaskViews ?? {};
    const existing = current[project.id];
    if (existing && viewsEqual(existing, snapshot)) return;

    const nextViews = {
      ...current,
      [project.id]: snapshot,
    };

    const timer = setTimeout(() => {
      setSyncError("");
      queryClient.setQueryData(["config"], (old: Config | undefined) => {
        if (!old) return old;
        return { ...old, projectTaskViews: nextViews };
      });

      saveViews(
        {
          taskViews: typedConfig.taskViews ?? [],
          activeTaskViewId: typedConfig.activeTaskViewId ?? "",
          projectTaskViews: nextViews,
        },
        {
          onError: async (error) => {
            if (error instanceof ApiError && error.status === 409) {
              setSyncError("Config conflict: reloading latest config...");
              await queryClient.invalidateQueries({ queryKey: ["config"] });
              await queryClient.refetchQueries({ queryKey: ["config"], type: "active" });
              return;
            }
            setSyncError("Failed to save this project's layout. Please retry.");
          },
        },
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [ready, snapshot, typedConfig, project.id, queryClient, saveViews]);

  return {
    configQuery,
    typedConfig,
    viewMode,
    setViewMode,
    groupFields,
    setGroupFields,
    groupSortDirection,
    setGroupSortDirection,
    dataMode,
    setDataMode,
    selectedStatusIds,
    setSelectedStatusIds,
    selectedPriorityLevels,
    setSelectedPriorityLevels,
    selectedLabelIds,
    setSelectedLabelIds,
    selectedStageIds,
    setSelectedStageIds,
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
    showReminders,
    setShowReminders,
    columnOrder,
    setColumnOrder,
    groupValueOrders,
    setGroupValueOrders,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    optionsVisible,
    setOptionsVisible,
    defaultGroups,
    syncError,
  };
}

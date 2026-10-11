"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Config, TaskViewConfig } from "@/app/_types/types";
import { ApiError } from "@/app/utils/api/worksapce";
import { useConfig, useUpdateTaskViewsConfig } from "@/app/utils/hooks/workspaces";
import { resolveViewOnlyDated, resolveViewShowCompleted } from "@/app/utils/taskFilters";

const EMPTY_VIEWS: TaskViewConfig[] = [];

export const NEW_VIEW_TEMPLATE: Omit<TaskViewConfig, "id" | "name"> = {
  dataMode: "task",
  renderMode: "list",
  groupFields: ["workspace", "project", "stage"],
  groupSortDirection: "asc",
  groupValueOrders: {},
  sortBy: "deadline",
  sortDirection: "asc",
  selectedWorkspaceIds: [],
  selectedStatusIds: [],
  selectedProjectIds: [],
  selectedPriorityLevels: [],
  selectedLabelIds: [],
  selectedStageIds: [],
  showCompleted: true,
  onlyOverdue: false,
  onlyScheduled: false,
  onlyRecurring: false,
  onlyDated: false,
  showReminders: false,
  columnOrder: [],
};

function resolveActiveId(views: TaskViewConfig[], preferred?: string) {
  if (preferred && views.some((view) => view.id === preferred)) return preferred;
  return views[0]?.id ?? "";
}

/**
 * Saved task views are the source of truth. Filter/layout edits write straight
 * into the active view object; a debounce persists the working copy.
 */
export function useTaskViewsState() {
  const queryClient = useQueryClient();
  const configQuery = useConfig();
  const typedConfig = configQuery.data as Config | undefined;
  const { mutate: saveViews } = useUpdateTaskViewsConfig();

  const configViews = typedConfig?.taskViews ?? EMPTY_VIEWS;
  const [draft, setDraft] = useState<{ views: TaskViewConfig[]; activeId: string } | null>(null);
  const [syncError, setSyncError] = useState("");

  const taskViews = draft?.views ?? configViews;
  const activeTaskViewId = resolveActiveId(
    taskViews,
    draft?.activeId ?? typedConfig?.activeTaskViewId,
  );
  const activeTaskView = useMemo(
    () => taskViews.find((view) => view.id === activeTaskViewId),
    [taskViews, activeTaskViewId],
  );
  const viewsReady = Boolean(typedConfig);

  const withDraft = useCallback(
    (
      updater: (
        views: TaskViewConfig[],
        activeId: string,
      ) => { views: TaskViewConfig[]; activeId: string },
    ) => {
      setDraft((previous) => {
        const views = previous?.views ?? configViews;
        const activeId = resolveActiveId(views, previous?.activeId ?? typedConfig?.activeTaskViewId);
        return updater(views, activeId);
      });
    },
    [configViews, typedConfig?.activeTaskViewId],
  );

  const setActiveTaskViewId = useCallback(
    (id: string) => {
      withDraft((views) => ({ views, activeId: id }));
    },
    [withDraft],
  );

  const patchActiveView = useCallback(
    (patch: Partial<TaskViewConfig>) => {
      withDraft((views, activeId) => ({
        views: views.map((view) => (view.id === activeId ? { ...view, ...patch } : view)),
        activeId,
      }));
    },
    [withDraft],
  );

  const addNewView = useCallback(() => {
    withDraft((views, activeId) => {
      const base = views.find((view) => view.id === activeId) ?? views[0];
      const id = `view_${Date.now()}`;
      const nextView: TaskViewConfig = {
        ...(base ?? NEW_VIEW_TEMPLATE),
        id,
        name: `New View ${views.length + 1}`,
      };
      return { views: [...views, nextView], activeId: id };
    });
  }, [withDraft]);

  const deleteActiveView = useCallback(() => {
    withDraft((views, activeId) => {
      if (views.length <= 1) return { views, activeId };
      const activeIndex = views.findIndex((view) => view.id === activeId);
      const next = views.filter((view) => view.id !== activeId);
      const fallbackIndex = activeIndex > 0 ? activeIndex - 1 : 0;
      return { views: next, activeId: next[fallbackIndex]?.id ?? next[0]?.id ?? "" };
    });
  }, [withDraft]);

  const renameView = useCallback(
    (viewId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) return;
      withDraft((views, activeId) => ({
        views: views.map((view) =>
          view.id === viewId && view.name !== nextName ? { ...view, name: nextName } : view,
        ),
        activeId,
      }));
    },
    [withDraft],
  );

  useEffect(() => {
    if (!viewsReady || !draft || taskViews.length === 0) return;

    const resolvedActiveTaskViewId = activeTaskViewId;
    if (!resolvedActiveTaskViewId) return;

    const timer = setTimeout(() => {
      setSyncError("");
      queryClient.setQueryData(["config"], (old: Config | undefined) => {
        if (!old) return old;
        return {
          ...old,
          taskViews,
          activeTaskViewId: resolvedActiveTaskViewId,
        };
      });

      saveViews(
        {
          taskViews,
          activeTaskViewId: resolvedActiveTaskViewId,
        },
        {
          // The saved list is the server's now, so later changes (a view the
          // assistant makes) show; edits made meanwhile keep their draft.
          onSuccess: (saved) => {
            queryClient.setQueryData(["config"], saved);
            setDraft((current) => (current === draft ? null : current));
          },
          onError: async (error) => {
            if (error instanceof ApiError && error.status === 409) {
              setSyncError("Config conflict: reloading latest config...");
              setDraft(null);
              await queryClient.invalidateQueries({ queryKey: ["config"] });
              await queryClient.refetchQueries({ queryKey: ["config"], type: "active" });
              return;
            }
            setSyncError("Failed to sync config changes. Please retry.");
          },
        },
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [viewsReady, draft, taskViews, activeTaskViewId, queryClient, saveViews]);

  const view = activeTaskView;

  return {
    configQuery,
    typedConfig,
    viewsReady,
    taskViews,
    activeTaskViewId,
    activeTaskView,
    setActiveTaskViewId,
    patchActiveView,
    addNewView,
    deleteActiveView,
    renameView,
    syncError,
    viewMode: view?.renderMode ?? "list",
    groupFields: view?.groupFields ?? NEW_VIEW_TEMPLATE.groupFields,
    groupSortDirection: view?.groupSortDirection ?? "asc",
    dataMode: view?.dataMode ?? "task",
    selectedWorkspaceIds: view?.selectedWorkspaceIds ?? [],
    selectedStatusIds: view?.selectedStatusIds ?? [],
    selectedProjectIds: view?.selectedProjectIds ?? [],
    selectedPriorityLevels: view?.selectedPriorityLevels ?? [],
    selectedLabelIds: view?.selectedLabelIds ?? [],
    selectedStageIds: view?.selectedStageIds ?? [],
    showCompleted: view ? resolveViewShowCompleted(view) : true,
    onlyOverdue: Boolean(view?.onlyOverdue),
    onlyScheduled: Boolean(view?.onlyScheduled),
    onlyRecurring: Boolean(view?.onlyRecurring),
    onlyDated: view ? resolveViewOnlyDated(view) : false,
    showReminders: Boolean(view?.showReminders),
    columnOrder: view?.columnOrder ?? [],
    groupValueOrders: view?.groupValueOrders ?? {},
    sortBy: view?.sortBy ?? "deadline",
    sortDirection: view?.sortDirection ?? "asc",
  };
}

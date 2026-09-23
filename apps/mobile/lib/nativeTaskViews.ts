import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { useAuth } from "./auth/AuthProvider";
import type {
  CustomField,
  Task,
  TaskListGroupField,
  TaskListSortBy,
  TaskRenderMode,
  TaskViewConfig,
} from "./types";

const EMPTY: string[] = [];

export const NATIVE_VIEW_TEMPLATE: Omit<TaskViewConfig, "id" | "name"> = {
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

export function defaultNativeTaskViews(): TaskViewConfig[] {
  return [
    {
      ...NATIVE_VIEW_TEMPLATE,
      id: "native_view_task_list",
      name: "Task List",
    },
    {
      ...NATIVE_VIEW_TEMPLATE,
      id: "native_view_my_deadlines",
      name: "My Deadlines",
      groupFields: ["priority"],
      showCompleted: false,
      onlyDated: true,
    },
    {
      ...NATIVE_VIEW_TEMPLATE,
      id: "native_view_overview",
      name: "Overview",
      groupFields: ["workspace"],
      sortBy: "createdAt",
      sortDirection: "desc",
    },
    {
      ...NATIVE_VIEW_TEMPLATE,
      id: "native_view_board",
      name: "Board",
      renderMode: "kanban",
      groupFields: ["status"],
    },
  ];
}

type StoredNativeViews = {
  views: TaskViewConfig[];
  activeId: string;
};

function fileUri(userId: string) {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}native-task-views-${userId}.json`;
}

function resolveActiveId(views: TaskViewConfig[], preferred?: string) {
  if (preferred && views.some((view) => view.id === preferred)) return preferred;
  return views[0]?.id ?? "";
}

function normalizeView(raw: Partial<TaskViewConfig> | null | undefined, fallbackId: string): TaskViewConfig {
  return {
    ...NATIVE_VIEW_TEMPLATE,
    ...raw,
    id: typeof raw?.id === "string" && raw.id ? raw.id : fallbackId,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : "View",
    groupFields: Array.isArray(raw?.groupFields) ? raw.groupFields.slice(0, 3) : NATIVE_VIEW_TEMPLATE.groupFields,
    groupValueOrders: raw?.groupValueOrders && typeof raw.groupValueOrders === "object" ? raw.groupValueOrders : {},
    selectedWorkspaceIds: raw?.selectedWorkspaceIds ?? EMPTY,
    selectedStatusIds: raw?.selectedStatusIds ?? EMPTY,
    selectedProjectIds: raw?.selectedProjectIds ?? EMPTY,
    selectedPriorityLevels: raw?.selectedPriorityLevels ?? EMPTY,
    selectedLabelIds: raw?.selectedLabelIds ?? EMPTY,
    selectedStageIds: raw?.selectedStageIds ?? EMPTY,
    columnOrder: raw?.columnOrder ?? EMPTY,
  };
}

function parseStored(raw: string): StoredNativeViews | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredNativeViews>;
    const views = (Array.isArray(parsed.views) ? parsed.views : [])
      .map((view, index) => normalizeView(view, `native_view_${index + 1}`))
      .filter((view) => view.id);
    if (views.length === 0) return null;
    return { views, activeId: resolveActiveId(views, parsed.activeId) };
  } catch {
    return null;
  }
}

async function loadStored(userId: string): Promise<StoredNativeViews> {
  const fallback: StoredNativeViews = {
    views: defaultNativeTaskViews(),
    activeId: "native_view_task_list",
  };
  const uri = fileUri(userId);
  if (!uri) return fallback;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return fallback;
    const parsed = parseStored(await FileSystem.readAsStringAsync(uri));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function saveStored(userId: string, payload: StoredNativeViews) {
  const uri = fileUri(userId);
  if (!uri) return;
  try {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload));
  } catch {
    // Local view layout only; a failed write should not surface as an unhandled rejection.
  }
}

export function groupFieldLabel(field: TaskListGroupField, customFields: CustomField[] = []) {
  if (field.startsWith("cf:")) {
    return customFields.find((item) => item.id === field.slice(3))?.name ?? "Custom field";
  }
  return field[0].toUpperCase() + field.slice(1);
}

export function customFieldGroupLabel(task: Task, fieldId: string) {
  const value = task.customFieldValues?.find((entry) => entry.customFieldId === fieldId);
  if (!value) return "Empty";
  if (value.stringValue?.trim()) return value.stringValue.trim();
  if (value.numberValue != null) return String(value.numberValue);
  if (value.boolValue != null) return value.boolValue ? "Yes" : "No";
  if (value.dateValue) return value.dateValue.slice(0, 10);
  if (value.optionValue?.length) {
    return value.optionValue.map((option) => option.value).filter(Boolean).join(", ") || "Empty";
  }
  return "Empty";
}

export const NATIVE_SORT_OPTIONS: { value: TaskListSortBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "deadline", label: "Deadline" },
  { value: "scheduledOn", label: "Scheduled date" },
  { value: "startDate", label: "Start date" },
  { value: "createdAt", label: "Created" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
];

export const NATIVE_RENDER_OPTIONS: { value: TaskRenderMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Board" },
];

export function useNativeTaskViews() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [views, setViews] = useState<TaskViewConfig[]>(defaultNativeTaskViews);
  const [activeId, setActiveIdState] = useState("native_view_task_list");
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    dirty.current = false;
    if (!userId) {
      setViews(defaultNativeTaskViews());
      setActiveIdState("native_view_task_list");
      setReady(true);
      return;
    }
    void loadStored(userId).then((stored) => {
      if (cancelled) return;
      setViews(stored.views);
      setActiveIdState(stored.activeId);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!ready || !userId || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void saveStored(userId, { views, activeId: resolveActiveId(views, activeId) });
    }, 280);
    return () => clearTimeout(timer);
  }, [ready, userId, views, activeId]);

  const setActiveId = useCallback((id: string) => {
    dirty.current = true;
    setActiveIdState(id);
  }, []);

  const patchActiveView = useCallback((patch: Partial<TaskViewConfig>) => {
    dirty.current = true;
    setViews((current) => {
      const id = resolveActiveId(current, activeIdRef.current);
      return current.map((view) => (view.id === id ? { ...view, ...patch } : view));
    });
  }, []);

  const addView = useCallback(() => {
    dirty.current = true;
    const id = `native_view_${Date.now()}`;
    setViews((current) => {
      const active = current.find((view) => view.id === resolveActiveId(current, activeIdRef.current)) ?? current[0];
      const nextView: TaskViewConfig = {
        ...(active ?? NATIVE_VIEW_TEMPLATE),
        id,
        name: `New View ${current.length + 1}`,
      };
      return [...current, nextView];
    });
    setActiveIdState(id);
  }, []);

  const deleteActiveView = useCallback(() => {
    dirty.current = true;
    setViews((current) => {
      if (current.length <= 1) return current;
      const id = resolveActiveId(current, activeIdRef.current);
      const index = current.findIndex((view) => view.id === id);
      const next = current.filter((view) => view.id !== id);
      const fallback = next[Math.max(0, index - 1)] ?? next[0];
      setActiveIdState(fallback?.id ?? "");
      return next;
    });
  }, []);

  const renameView = useCallback((viewId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    dirty.current = true;
    setViews((current) =>
      current.map((view) => (view.id === viewId ? { ...view, name: nextName } : view)),
    );
  }, []);

  const activeViewId = resolveActiveId(views, activeId);
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId),
    [activeViewId, views],
  );

  return {
    ready,
    views,
    activeView,
    activeViewId,
    setActiveId,
    patchActiveView,
    addView,
    deleteActiveView,
    renameView,
  };
}

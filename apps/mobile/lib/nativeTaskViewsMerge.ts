/**
 * Pure helpers for the phone's saved task views: the built-in views, reading
 * a raw list, and how the device copy, an unsent change and the server's copy
 * are merged. No React or device APIs here, so node tests can load it.
 */
import type { TaskViewConfig } from "./types";

/** The server refuses a longer list (models.MaxTaskViews). */
export const MAX_VIEWS = 20;

const EMPTY: string[] = [];

export type Snapshot = {
  views: TaskViewConfig[];
  activeId: string;
};

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

/** Ids of the built-in views (the server seeds the same ones). */
export const DEFAULT_VIEW_IDS: ReadonlySet<string> = new Set(defaultNativeTaskViews().map((view) => view.id));

export function resolveActiveId(views: TaskViewConfig[], preferred?: string) {
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

/** Reads a raw list into full views; the first view wins on a repeated id. */
export function normalizeViews(raw: unknown): TaskViewConfig[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .map((view, index) => normalizeView(view as Partial<TaskViewConfig>, `native_view_${index + 1}`))
    .filter((view) => {
      if (!view.id || seen.has(view.id)) return false;
      seen.add(view.id);
      return true;
    });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonical(item);
    }
    return out;
  }
  return value;
}

/** Same settings, whatever the key order. */
export function sameView(a: TaskViewConfig, b: TaskViewConfig) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function sameViews(a: TaskViewConfig[], b: TaskViewConfig[]) {
  return a.length === b.length && a.every((view, index) => sameView(view, b[index]));
}

/** The snapshot's views, then the extra ones it lacks. */
export function withExtra(snapshot: Snapshot, extra: TaskViewConfig[]): Snapshot {
  if (extra.length === 0) return snapshot;
  const ids = new Set(snapshot.views.map((view) => view.id));
  const added = extra.filter((view) => !ids.has(view.id));
  return added.length ? { ...snapshot, views: [...snapshot.views, ...added] } : snapshot;
}

/**
 * The first merge of a device copy that was never synced into the server's
 * list. The server may hold only the built-in views it seeded (plus a view
 * the assistant made), so for built-in ids the device's own version wins;
 * the server's other views are kept, and views only on the device follow.
 */
export function adoptDeviceViews(server: TaskViewConfig[], device: TaskViewConfig[]): TaskViewConfig[] {
  const deviceById = new Map(device.map((view) => [view.id, view]));
  const serverIds = new Set(server.map((view) => view.id));
  const merged = server.map((view) => (DEFAULT_VIEW_IDS.has(view.id) ? deviceById.get(view.id) ?? view : view));
  return [...merged, ...device.filter((view) => !serverIds.has(view.id))];
}

/**
 * Three-way merge of an unsent change (`draft`, made on top of `base`) onto
 * the server's current list. The draft's own changes win: views it added,
 * changed or deleted. Views it left alone follow the server (its newer
 * version, or gone when deleted there), and views new on the server (made by
 * the assistant or another device) are added after the draft's.
 */
export function rebaseViews(draft: Snapshot, base: TaskViewConfig[], server: TaskViewConfig[]): Snapshot {
  const baseById = new Map(base.map((view) => [view.id, view]));
  const serverById = new Map(server.map((view) => [view.id, view]));
  const draftIds = new Set(draft.views.map((view) => view.id));
  const views: TaskViewConfig[] = [];
  for (const view of draft.views) {
    const before = baseById.get(view.id);
    if (before && sameView(before, view)) {
      const latest = serverById.get(view.id);
      if (latest) views.push(latest);
      continue;
    }
    views.push(view);
  }
  for (const view of server) {
    if (!baseById.has(view.id) && !draftIds.has(view.id)) views.push(view);
  }
  const result = views.length ? views : draft.views;
  return { views: result, activeId: resolveActiveId(result, draft.activeId) };
}

/**
 * Splits a list into what the server takes (at most `max`, always with the
 * active view) and the rest, which stays only on this device. Order is kept.
 */
export function capForServer(snapshot: Snapshot, max = MAX_VIEWS): { sent: Snapshot; extra: TaskViewConfig[] } {
  const activeId = resolveActiveId(snapshot.views, snapshot.activeId);
  if (snapshot.views.length <= max) return { sent: { views: snapshot.views, activeId }, extra: [] };
  const keep = new Set(snapshot.views.slice(0, max).map((view) => view.id));
  if (activeId && !keep.has(activeId)) {
    keep.delete(snapshot.views[max - 1].id);
    keep.add(activeId);
  }
  return {
    sent: { views: snapshot.views.filter((view) => keep.has(view.id)), activeId },
    extra: snapshot.views.filter((view) => !keep.has(view.id)),
  };
}

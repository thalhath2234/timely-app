import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { useAuth } from "./auth/AuthProvider";
import { ApiError } from "./api/client";
import { getConfig, updateConfig } from "./api/workspaces";
import { keys, useConfigQuery } from "./hooks";
import {
  adoptDeviceViews,
  capForServer,
  defaultNativeTaskViews,
  MAX_VIEWS,
  NATIVE_VIEW_TEMPLATE,
  normalizeViews,
  rebaseViews,
  resolveActiveId,
  sameViews,
  withExtra,
  type Snapshot,
} from "./nativeTaskViewsMerge";
import { useToastStore } from "./toast";
import type {
  CustomField,
  Task,
  TaskListGroupField,
  TaskViewSortBy,
  TaskRenderMode,
  TaskViewConfig,
} from "./types";

export { NATIVE_VIEW_TEMPLATE, defaultNativeTaskViews } from "./nativeTaskViewsMerge";

const NO_VIEWS: TaskViewConfig[] = [];

/**
 * The device copy of the phone's views. The server keeps them
 * (config.mobileTaskViews); this file is the offline cache. `synced` is false
 * only in files written before the server kept them, and `dirty` marks a
 * change the server has not taken yet, with `base` the server list it was
 * made on. `extra` holds views past the server's limit, kept only here.
 */
type StoredNativeViews = Snapshot & {
  synced?: boolean;
  dirty?: boolean;
  base?: TaskViewConfig[];
  extra?: TaskViewConfig[];
};

/** An unsent change and the server list it was made on. */
type Draft = { snapshot: Snapshot; base: TaskViewConfig[] };

function fileUri(userId: string) {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}native-task-views-${userId}.json`;
}

function parseStored(raw: string): StoredNativeViews | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredNativeViews>;
    const views = normalizeViews(parsed.views);
    if (views.length === 0) return null;
    return {
      views,
      activeId: resolveActiveId(views, parsed.activeId),
      synced: parsed.synced === true,
      dirty: parsed.dirty === true,
      base: Array.isArray(parsed.base) ? normalizeViews(parsed.base) : undefined,
      extra: normalizeViews(parsed.extra),
    };
  } catch {
    return null;
  }
}

async function loadStored(userId: string): Promise<StoredNativeViews | null> {
  const uri = fileUri(userId);
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return parseStored(await FileSystem.readAsStringAsync(uri));
  } catch {
    return null;
  }
}

async function saveStored(userId: string, payload: StoredNativeViews) {
  const uri = fileUri(userId);
  if (!uri) return;
  try {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload));
  } catch {
    // Only the offline copy; a failed write should not surface as an unhandled rejection.
  }
}

/** The clean device copy of a server list, with the views kept only here. */
function cleanCopy(server: Snapshot, extra: TaskViewConfig[]): StoredNativeViews {
  const ids = new Set(server.views.map((view) => view.id));
  return { ...server, extra: extra.filter((view) => !ids.has(view.id)), synced: true, dirty: false };
}

const SAVE_DELAY_MS = 300;

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
  if (value.boolValue != null) return value.boolValue ? "Yes" : "No";
  if (value.optionValue?.length) {
    return value.optionValue.map((option) => option.value).filter(Boolean).join(", ") || "Empty";
  }
  return "Empty";
}

export const NATIVE_SORT_OPTIONS: { value: TaskViewSortBy; label: string }[] = [
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

/**
 * The phone's saved task views. The server keeps them (config.mobileTaskViews,
 * apart from the web and desktop views) so the assistant and smart search
 * can use them; a file on the device is the offline copy. Changes show at
 * once and are saved a moment after the last one, the whole list at a time.
 */
export function useNativeTaskViews() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const client = useQueryClient();
  const configQuery = useConfigQuery();
  const config = configQuery.data;
  const [local, setLocal] = useState<{ userId: string; stored: StoredNativeViews | null } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bumped by every change; `savedRevision` is the last one the server took
  // (or refused). While they differ the device copy must not follow the server.
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const pending = useRef<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const migrated = useRef("");

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    void loadStored(userId).then((stored) => {
      if (!cancelled) setLocal({ userId, stored });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // An older server sends no phone views; the device copy is used alone.
  const serverKeeps = Boolean(config && Array.isArray(config.mobileTaskViews));
  const serverViews = useMemo(() => normalizeViews(config?.mobileTaskViews), [config?.mobileTaskViews]);
  const serverActive = config?.mobileActiveTaskViewId;
  const server = useMemo<Snapshot | null>(
    () => (serverViews.length ? { views: serverViews, activeId: resolveActiveId(serverViews, serverActive) } : null),
    [serverActive, serverViews],
  );
  const localLoaded = local?.userId === userId;
  const device = localLoaded ? local?.stored ?? null : null;
  const extra = device?.extra ?? NO_VIEWS;
  const fallback = useMemo<Snapshot>(() => ({ views: defaultNativeTaskViews(), activeId: "native_view_task_list" }), []);
  // An unsent change is shown merged onto the server's latest list, so views
  // the assistant made meanwhile show (and ?view=<id> finds them).
  const current = useMemo<Snapshot>(() => {
    if (draft) return server ? rebaseViews(draft.snapshot, draft.base, server.views) : draft.snapshot;
    if (server) return withExtra(server, extra);
    if (device) return withExtra(device, extra);
    return fallback;
  }, [device, draft, extra, fallback, server]);
  const ready = !userId || localLoaded;

  const currentRef = useRef(current);
  const serverRef = useRef(server);
  useEffect(() => {
    currentRef.current = current;
    serverRef.current = server;
  });

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const sent = revision.current;
    const keepForLater = () => {
      if (!pending.current) pending.current = next;
    };
    // Merge onto the server's latest list so views made elsewhere since this
    // change began are not overwritten.
    let latest: TaskViewConfig[] | null = null;
    try {
      const fresh = await client.fetchQuery({ queryKey: keys.config, queryFn: getConfig, staleTime: 0 });
      latest = Array.isArray(fresh.mobileTaskViews) ? normalizeViews(fresh.mobileTaskViews) : null;
    } catch {
      // Offline or failing: the change stays on this device and is sent again
      // when the app comes back to the foreground.
      keepForLater();
      return;
    }
    const merged = latest ? rebaseViews(next.snapshot, next.base, latest) : next.snapshot;
    const { sent: out, extra: deviceOnly } = capForServer(merged);
    try {
      const saved = await updateConfig({ mobileTaskViews: out.views, mobileActiveTaskViewId: out.activeId });
      // A config fetch begun before the save must not roll the views back.
      await client.cancelQueries({ queryKey: keys.config });
      client.setQueryData(keys.config, saved);
      if (revision.current !== sent) return;
      savedRevision.current = sent;
      draftRef.current = null;
      setDraft(null);
      if (userId) {
        const savedViews = normalizeViews(saved.mobileTaskViews);
        const stored: StoredNativeViews = savedViews.length
          ? cleanCopy({ views: savedViews, activeId: resolveActiveId(savedViews, saved.mobileActiveTaskViewId) }, deviceOnly)
          : { ...withExtra(out, deviceOnly), synced: false, dirty: false };
        setLocal({ userId, stored });
        void saveStored(userId, stored);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        // The server refused this list (a conflict or a limit): show its copy.
        if (error.status !== 409) useToastStore.getState().show(error.message || "Couldn't save your views");
        if (revision.current === sent) {
          savedRevision.current = sent;
          draftRef.current = null;
          setDraft(null);
        }
        void client.invalidateQueries({ queryKey: keys.config });
        return;
      }
      keepForLater();
    }
  }, [client, userId]);

  /**
   * Shows and stores a change, and sends it a moment later. `base` is the
   * server list it was made on: by default the server list on screen, since
   * an unsent change is shown already merged onto it.
   */
  const commit = useCallback(
    (next: Snapshot, baseOverride?: TaskViewConfig[]) => {
      const base = baseOverride ?? serverRef.current?.views ?? draftRef.current?.base ?? NO_VIEWS;
      const nextDraft: Draft = { snapshot: next, base };
      revision.current += 1;
      pending.current = nextDraft;
      draftRef.current = nextDraft;
      currentRef.current = next;
      setDraft(nextDraft);
      if (userId) {
        const stored: StoredNativeViews = { ...next, synced: true, dirty: true, base };
        setLocal({ userId, stored });
        void saveStored(userId, stored);
      }
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, userId],
  );

  // Once per account on this device: the server takes the device's views when
  // it has none (the built-in ones when the device has none either), a change
  // left unsent is sent again, and a device copy from before the server kept
  // the views is merged into the server's.
  useEffect(() => {
    if (!userId || !localLoaded || !serverKeeps || migrated.current === userId) return;
    migrated.current = userId;
    if (device?.dirty) {
      commit({ views: device.views, activeId: device.activeId }, device.base ?? NO_VIEWS);
      return;
    }
    if (!server) {
      commit(device ? withExtra(device, extra) : fallback, NO_VIEWS);
      return;
    }
    if (device && !device.synced) {
      const views = adoptDeviceViews(server.views, withExtra(device, extra).views);
      if (!sameViews(views, server.views)) commit({ views, activeId: server.activeId }, server.views);
    }
  }, [commit, device, extra, fallback, localLoaded, server, serverKeeps, userId]);

  // The device copy follows what the server keeps, but never while a change
  // is still on its way: until the save lands the file is the only copy.
  const serverKey = server ? JSON.stringify(server) : "";
  useEffect(() => {
    if (!userId || !serverKey || draft || migrated.current !== userId) return;
    if (pending.current || revision.current !== savedRevision.current) return;
    void saveStored(userId, cleanCopy(JSON.parse(serverKey) as Snapshot, extra));
  }, [draft, extra, serverKey, userId]);

  // Coming back to the app sends a change that could not be saved, then
  // shows views the assistant or another device made; leaving saves the last one.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void (async () => {
          if (pending.current && timer.current === null) await flush();
          void client.invalidateQueries({ queryKey: keys.config });
        })();
      } else void flush();
    });
    return () => {
      subscription.remove();
      void flush();
    };
  }, [client, flush]);

  const update = useCallback(
    (change: (current: Snapshot) => Snapshot) => {
      const base = currentRef.current;
      const next = change(base);
      if (next === base) return;
      commit(next);
    },
    [commit],
  );

  const setActiveId = useCallback(
    (id: string) => update((state) => (state.activeId === id ? state : { ...state, activeId: id })),
    [update],
  );

  const patchActiveView = useCallback(
    (patch: Partial<TaskViewConfig>) =>
      update((state) => {
        const id = resolveActiveId(state.views, state.activeId);
        return { activeId: id, views: state.views.map((view) => (view.id === id ? { ...view, ...patch } : view)) };
      }),
    [update],
  );

  const addView = useCallback(() => {
    update((state) => {
      if (state.views.length >= MAX_VIEWS) {
        useToastStore.getState().show(`You can keep up to ${MAX_VIEWS} views`);
        return state;
      }
      const id = `native_view_${Date.now()}`;
      const active = state.views.find((view) => view.id === resolveActiveId(state.views, state.activeId)) ?? state.views[0];
      const nextView: TaskViewConfig = {
        ...(active ?? NATIVE_VIEW_TEMPLATE),
        id,
        name: `New View ${state.views.length + 1}`,
      };
      return { views: [...state.views, nextView], activeId: id };
    });
  }, [update]);

  const deleteActiveView = useCallback(() => {
    update((state) => {
      if (state.views.length <= 1) return state;
      const id = resolveActiveId(state.views, state.activeId);
      const index = state.views.findIndex((view) => view.id === id);
      const next = state.views.filter((view) => view.id !== id);
      const fallbackView = next[Math.max(0, index - 1)] ?? next[0];
      return { views: next, activeId: fallbackView?.id ?? "" };
    });
  }, [update]);

  const renameView = useCallback(
    (viewId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) return;
      update((state) => ({
        ...state,
        views: state.views.map((view) => (view.id === viewId ? { ...view, name: nextName } : view)),
      }));
    },
    [update],
  );

  const views = current.views;
  const activeViewId = resolveActiveId(views, current.activeId);
  const activeView = useMemo(() => views.find((view) => view.id === activeViewId), [activeViewId, views]);

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
    /** True while the server copy is being fetched. */
    syncing: configQuery.isFetching,
    /** Fetches the server copy again, e.g. for a view the assistant just made. */
    refresh: configQuery.refetch,
  };
}

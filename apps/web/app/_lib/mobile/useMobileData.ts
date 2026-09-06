"use client";

import { useEffect, useMemo, useState } from "react";
import { useTasks, useUpdateTask } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useProjects } from "@/app/utils/hooks/projects";
import {
  useAddTaskBlock,
  useCalendarRange,
  useMoveBlock,
  useUpdateEvent,
} from "@/app/utils/hooks/calendar";
import { useDocs } from "@/app/utils/hooks/docs";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useMe } from "@/app/utils/hooks/user";
import type {
  CalendarItem,
  Doc,
  Project,
  Sheet,
  Task,
  User,
  Workspace,
} from "@/app/_types/types";
import {
  SAMPLE_CALENDAR_ITEMS,
  SAMPLE_DOCS,
  SAMPLE_PROJECTS,
  SAMPLE_SHEETS,
  SAMPLE_TASKS,
  SAMPLE_USER,
  SAMPLE_WORKSPACES,
} from "./sampleData";
import { useDemoStore } from "./demoStore";
import { mergeCalendarItems } from "./mergeBlocks";

/** How long we wait for the Go backend before showing sample data. */
const FALLBACK_AFTER_MS = 1200;

interface MobileData<T> {
  data: T;
  isDemo: boolean;
  isLoading: boolean;
}

/**
 * Uses the live query result when the API answers; otherwise (network error or
 * still pending after a short grace period) swaps in the sample dataset.
 */
interface QueryLike<T> {
  data: T | undefined;
  isSuccess: boolean;
  isError: boolean;
}

function useWithFallback<T>(query: QueryLike<T>, sample: T): MobileData<T> {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (query.isSuccess) return;
    const id = window.setTimeout(() => setTimedOut(true), FALLBACK_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [query.isSuccess]);

  if (query.isSuccess && query.data !== undefined) {
    return { data: query.data, isDemo: false, isLoading: false };
  }
  if (query.isError || timedOut) {
    return { data: sample, isDemo: true, isLoading: false };
  }
  return { data: sample, isDemo: true, isLoading: true };
}

export function useMobileUser(): MobileData<User> {
  return useWithFallback(useMe(), SAMPLE_USER);
}

export function useMobileWorkspaces(): MobileData<Workspace[]> {
  return useWithFallback(useWorkspaces(), SAMPLE_WORKSPACES);
}

export function useMobileProjects(): MobileData<Project[]> {
  return useWithFallback(useProjects(), SAMPLE_PROJECTS);
}

export function useMobileTasks(): MobileData<Task[]> {
  const result = useWithFallback(useTasks(), SAMPLE_TASKS);
  const overrides = useDemoStore((s) => s.taskOverrides);
  const created = useDemoStore((s) => s.createdTasks);
  const removed = useDemoStore((s) => s.removedTaskIds);

  const data = useMemo(() => {
    if (!result.isDemo) return result.data;
    return [...created, ...result.data]
      .filter((t) => !removed.includes(t.id))
      .map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t));
  }, [result.isDemo, result.data, overrides, created, removed]);

  return { ...result, data };
}

export function useMobileTask(id: string) {
  const tasks = useMobileTasks();
  return {
    ...tasks,
    data: tasks.data.find((t) => t.id === id) ?? null,
  };
}

/** Save helper that writes through to the API when live, or locally in demo. */
export function useMobileTaskSaver(isDemo: boolean) {
  const update = useUpdateTask();
  const patchTask = useDemoStore((s) => s.patchTask);

  return (id: string, patch: Partial<Task>) => {
    if (isDemo) {
      patchTask(id, { ...patch, updatedAt: new Date().toISOString() });
      return;
    }
    update.mutate({ id, ...(patch as object) });
  };
}

/**
 * Moves an existing block or pins a new one for a task. In sample mode this is
 * a no-op beyond closing the picker; the sample dataset has no block store.
 */
export function useMobileBlockScheduler(isDemo: boolean) {
  const move = useMoveBlock();
  const add = useAddTaskBlock();
  const update = useUpdateEvent();

  return {
    pending: move.isPending || add.isPending || update.isPending,
    moveBlock(blockId: string, start: Date, durationMs: number) {
      if (isDemo) return Promise.resolve();
      return move.mutateAsync({
        blockId,
        start: start.toISOString(),
        end: new Date(start.getTime() + durationMs).toISOString(),
      });
    },
    scheduleTask(taskId: string, start: Date, durationMinutes: number) {
      if (isDemo) return Promise.resolve();
      return add.mutateAsync({ taskId, start: start.toISOString(), durationMinutes });
    },
    moveEvent(eventId: string, start: Date, end: Date) {
      if (isDemo) return Promise.resolve();
      return update.mutateAsync({
        id: eventId,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    },
  };
}

export function useMobileCalendar(from: Date, to: Date): MobileData<CalendarItem[]> {
  const query = useCalendarRange(from, to);
  const sample = useMemo(
    () =>
      SAMPLE_CALENDAR_ITEMS.filter((item) => {
        const s = new Date(item.start).getTime();
        const e = new Date(item.end).getTime();
        return e >= from.getTime() && s <= to.getTime();
      }),
    [from, to],
  );
  const result = useWithFallback<CalendarItem[]>(
    { data: query.data?.items, isSuccess: query.isSuccess, isError: query.isError },
    sample,
  );

  const overrides = useDemoStore((s) => s.taskOverrides);
  const data = useMemo(() => {
    const merged = mergeCalendarItems(result.data);
    if (!result.isDemo) return merged;
    return merged.map((item) =>
      item.taskId && overrides[item.taskId]
        ? {
            ...item,
            completedAt: overrides[item.taskId].completedAt ?? item.completedAt,
            title: overrides[item.taskId].name ?? item.title,
          }
        : item,
    );
  }, [result.isDemo, result.data, overrides]);

  return { ...result, data };
}

export function useMobileDocs(): MobileData<Doc[]> {
  return useWithFallback(useDocs(), SAMPLE_DOCS);
}

export function useMobileDoc(id: string) {
  const docs = useMobileDocs();
  return { ...docs, data: docs.data.find((d) => d.id === id) ?? null };
}

export function useMobileSheets(): MobileData<Sheet[]> {
  return useWithFallback(useSheets(), SAMPLE_SHEETS);
}

export function useMobileSheet(id: string) {
  const sheets = useMobileSheets();
  return { ...sheets, data: sheets.data.find((s) => s.id === id) ?? null };
}

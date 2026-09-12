"use client";

import { useMemo } from "react";
import { useTask, useTasks, useUpdateTask } from "@/app/utils/hooks/tasks";
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
import { mergeCalendarItems } from "./mergeBlocks";

interface MobileData<T> {
  data: T;
  isDemo: false;
  isLoading: boolean;
  isError: boolean;
}

interface QueryLike<T> {
  data: T | undefined;
  isSuccess: boolean;
  isError: boolean;
  isPending?: boolean;
  refetch?: () => void;
}

function useLive<T>(query: QueryLike<T>, fallback: T): MobileData<T> {
  if (query.isSuccess && query.data !== undefined) {
    return { data: query.data, isDemo: false, isLoading: false, isError: false };
  }
  return {
    data: fallback,
    isDemo: false,
    isLoading: Boolean(query.isPending) || (!query.isSuccess && !query.isError),
    isError: query.isError,
  };
}

export function useMobileUser(): MobileData<User | null> {
  return useLive(useMe(), null);
}

export function useMobileWorkspaces(): MobileData<Workspace[]> {
  return useLive(useWorkspaces(), []);
}

export function useMobileProjects(): MobileData<Project[]> {
  return useLive(useProjects(), []);
}

export function useMobileTasks(): MobileData<Task[]> {
  return useLive(useTasks(), []);
}

export function useMobileTask(id: string) {
  const tasks = useMobileTasks();
  const fromList = tasks.data.find((t) => t.id === id) ?? null;
  const fetched = useTask(!fromList ? id : undefined);
  return {
    ...tasks,
    isLoading: tasks.isLoading || (!fromList && fetched.isLoading),
    isError: tasks.isError || fetched.isError,
    data: fromList ?? fetched.data ?? null,
  };
}

export function useMobileTaskSaver(_isDemo: boolean) {
  const update = useUpdateTask();
  return (id: string, patch: Partial<Task>) => {
    update.mutate({ id, ...(patch as object) });
  };
}

export function useMobileBlockScheduler(_isDemo: boolean) {
  const move = useMoveBlock();
  const add = useAddTaskBlock();
  const update = useUpdateEvent();

  return {
    pending: move.isPending || add.isPending || update.isPending,
    moveBlock(blockId: string, start: Date, durationMs: number) {
      return move.mutateAsync({
        blockId,
        start: start.toISOString(),
        end: new Date(start.getTime() + durationMs).toISOString(),
      });
    },
    scheduleTask(taskId: string, start: Date, durationMinutes: number) {
      return add.mutateAsync({ taskId, start: start.toISOString(), durationMinutes });
    },
    moveEvent(eventId: string, start: Date, end: Date) {
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
  const result = useLive<CalendarItem[]>(
    { data: query.data?.items, isSuccess: query.isSuccess, isError: query.isError, isPending: query.isPending },
    [],
  );
  const data = useMemo(() => mergeCalendarItems(result.data), [result.data]);
  return { ...result, data };
}

export function useMobileDocs(): MobileData<Doc[]> {
  return useLive(useDocs(), []);
}

export function useMobileDoc(id: string) {
  const docs = useMobileDocs();
  return { ...docs, data: docs.data.find((d) => d.id === id) ?? null };
}

export function useMobileSheets(): MobileData<Sheet[]> {
  return useLive(useSheets(), []);
}

export function useMobileSheet(id: string) {
  const sheets = useMobileSheets();
  return { ...sheets, data: sheets.data.find((s) => s.id === id) ?? null };
}

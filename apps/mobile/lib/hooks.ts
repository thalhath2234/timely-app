import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "./api/auth";
import { getTasks, getTask, updateTask, deleteTask, createTask, getTaskActivity, addTaskComment, editTaskOccurrence, splitTaskSeries, bulkUpdateTasks, duplicateTask, addChecklistItem, updateChecklistItem, deleteChecklistItem, startFocus, stopFocus, setTodayFocus } from "./api/tasks";
import { getDocs, getDoc, createDoc, updateDoc, deleteDoc, watchDoc, type DocWatchEvent } from "./api/docs";
import type { Doc } from "./types";
import { getSheets, getSheet, createSheet, updateSheet, deleteSheet } from "./api/sheets";
import { getProjects, getProject, createProject, updateProject, deleteProject, createStage, updateStage, deleteStage, reorderStages, duplicateProject } from "./api/projects";
import { getWorkspaces, getConfig } from "./api/workspaces";
import {
  addTaskBlock,
  applySchedule,
  getCalendarRange,
  getToday,
  getWorkingHours,
  moveBlock,
  previewSchedule,
  updateWorkingHours,
} from "./api/schedule";
import { useScheduleActivity } from "./scheduleActivity";
import { createEvent, deleteEvent, editEventOccurrence, getEvent, splitEventSeries, updateEvent } from "./api/events";
import { searchItems } from "./api/search";
import { listApiKeys, createApiKey, revokeApiKey } from "./api/apiKeys";
import type { UpdateTaskPayload } from "./api/tasks";
import type { MentionEntityType, Sheet } from "./types";

export type MentionItem = {
  id: string;
  label: string;
  entityType: MentionEntityType;
  hint?: string;
};

function mentionTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export const keys = {
  me: ["me"] as const,
  tasks: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  docs: ["docs"] as const,
  doc: (id: string) => ["docs", id] as const,
  sheets: ["sheets"] as const,
  sheet: (id: string) => ["sheets", id] as const,
  projects: ["projects"] as const,
  workspaces: ["workspaces"] as const,
  config: ["config"] as const,
  calendar: (from: string, to: string) => ["calendar", from, to] as const,
  hours: ["working-hours"] as const,
  activity: (id: string) => ["task-activity", id] as const,
  search: (q: string) => ["search", q] as const,
  event: (id: string) => ["event", id] as const,
  apiKeys: ["api-keys"] as const,
  inbox: ["tasks", "inbox"] as const,
  today: ["today"] as const,
};

export function useMeQuery() {
  return useQuery({ queryKey: keys.me, queryFn: getMe });
}

export function useTasksQuery() {
  return useQuery({ queryKey: keys.tasks, queryFn: () => getTasks() });
}

export function useInboxQuery() {
  return useQuery({ queryKey: keys.inbox, queryFn: () => getTasks({ inbox: true }) });
}

export function useTodayQuery() {
  return useQuery({ queryKey: keys.today, queryFn: () => getToday() });
}

export function useTaskQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.task(id ?? ""),
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
  });
}

export function useDocsQuery() {
  return useQuery({ queryKey: keys.docs, queryFn: getDocs });
}

export function useDocQuery(id: string) {
  return useQuery({
    queryKey: keys.doc(id),
    queryFn: () => getDoc(id),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useSheetsQuery() {
  return useQuery({ queryKey: keys.sheets, queryFn: getSheets });
}

export function useSheetQuery(id: string) {
  return useQuery({
    queryKey: keys.sheet(id),
    queryFn: () => getSheet(id),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useProjectsQuery() {
  return useQuery({ queryKey: keys.projects, queryFn: getProjects });
}

export function useProjectQuery(id?: string) {
  return useQuery({
    queryKey: [...keys.projects, id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });
}

export function useWorkspacesQuery() {
  return useQuery({ queryKey: keys.workspaces, queryFn: getWorkspaces });
}

export function useConfigQuery() {
  return useQuery({ queryKey: keys.config, queryFn: getConfig });
}

export function useCalendarQuery(from: Date, to: Date) {
  return useQuery({
    queryKey: keys.calendar(from.toISOString(), to.toISOString()),
    queryFn: () => getCalendarRange(from, to),
  });
}

export function useWorkingHoursQuery() {
  return useQuery({ queryKey: keys.hours, queryFn: getWorkingHours });
}

export function useTaskActivityQuery(id: string) {
  return useQuery({ queryKey: keys.activity(id), queryFn: () => getTaskActivity(id), enabled: Boolean(id) });
}

export function useMentionItems(): MentionItem[] {
  const docs = useDocsQuery().data ?? [];
  const sheets = useSheetsQuery().data ?? [];
  const tasks = useTasksQuery().data ?? [];
  const projects = useProjectsQuery().data ?? [];
  const workspaces = useWorkspacesQuery().data ?? [];

  return useMemo(() => {
    const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
    const entries: { item: MentionItem; updatedAt: number }[] = [];

    for (const doc of docs) {
      entries.push({
        item: {
          id: doc.id,
          label: doc.title,
          entityType: "doc",
          hint: workspaceNames.get(doc.workspaceId),
        },
        updatedAt: mentionTime(doc.updatedAt),
      });
    }
    for (const sheet of sheets) {
      entries.push({
        item: {
          id: sheet.id,
          label: sheet.title,
          entityType: "sheet",
          hint: workspaceNames.get(sheet.workspaceId),
        },
        updatedAt: mentionTime(sheet.updatedAt),
      });
    }
    for (const task of tasks) {
      entries.push({
        item: {
          id: task.id,
          label: task.name,
          entityType: "task",
          hint: task.project?.title ?? (task.workspaceId ? workspaceNames.get(task.workspaceId) : undefined),
        },
        updatedAt: mentionTime(task.updatedAt),
      });
    }
    for (const project of projects) {
      entries.push({
        item: {
          id: project.id,
          label: project.title,
          entityType: "project",
          hint: workspaceNames.get(project.workspaceId),
        },
        updatedAt: mentionTime(project.updatedAt),
      });
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt).map((entry) => entry.item);
  }, [docs, sheets, tasks, projects, workspaces]);
}

export function useSearchQuery(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();
  return useQuery({
    queryKey: keys.search(trimmed),
    queryFn: () => searchItems(trimmed),
    enabled: trimmed.length > 0,
  });
}

export function useApiKeysQuery() {
  return useQuery({ queryKey: keys.apiKeys, queryFn: listApiKeys });
}

export function useInvalidateAll() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.tasks }),
      client.invalidateQueries({ queryKey: ["calendar"] }),
      client.invalidateQueries({ queryKey: keys.docs }),
      client.invalidateQueries({ queryKey: keys.sheets }),
      client.invalidateQueries({ queryKey: keys.projects }),
      client.invalidateQueries({ queryKey: keys.workspaces }),
      client.invalidateQueries({ queryKey: keys.inbox }),
      client.invalidateQueries({ queryKey: keys.today }),
    ]);
}

export function useAutoScheduleAfterCreate() {
  const invalidate = useInvalidateAll();
  return async () => {
    const activity = useScheduleActivity.getState();
    activity.start();
    try {
      const plan = await applySchedule({});
      await invalidate();
      activity.finish(plan.proposals?.length ?? 0);
    } catch (err) {
      activity.fail(err instanceof Error ? err.message : "Could not auto-schedule.");
    }
  };
}

export function useSaveTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskPayload }) => updateTask(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.tasks });
      client.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export function useEditTaskOccurrence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      originalStart: string;
      action: "complete" | "uncomplete" | "skip" | "restore" | "move";
      newStart?: string;
      newEnd?: string;
    }) => editTaskOccurrence(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.tasks });
      client.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export function useSplitTaskSeries() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      fromStart: string;
      recurrence?: Parameters<typeof splitTaskSeries>[1]["recurrence"];
      name?: string;
      duration?: number;
    }) => splitTaskSeries(id, data),
    onSuccess: invalidate,
  });
}

export function useEventQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.event(id ?? ""),
    queryFn: () => getEvent(id!),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useEditEventOccurrence() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      originalStart: string;
      action: "skip" | "restore" | "move";
      newStart?: string;
      newEnd?: string;
    }) => editEventOccurrence(id, data),
    onSuccess: invalidate,
  });
}

export function useSplitEventSeries() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      fromStart: string;
      recurrence?: Parameters<typeof splitEventSeries>[1]["recurrence"];
      title?: string;
      start?: string;
      end?: string;
    }) => splitEventSeries(id, data),
    onSuccess: invalidate,
  });
}

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  const autoSchedule = useAutoScheduleAfterCreate();
  return useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await invalidate();
      void autoSchedule();
    },
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: deleteTask, onSuccess: invalidate });
}

export function useBulkUpdateTasks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, update }: { ids: string[]; update: UpdateTaskPayload }) =>
      bulkUpdateTasks(ids, update),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.tasks });
      client.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export function useCreateDoc() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createDoc,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.docs }),
  });
}

export function useUpdateDoc() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateDoc>[1] }) => updateDoc(id, data),
    onSuccess: (next) => {
      client.setQueryData(keys.doc(next.id), next);
      client.setQueryData<Doc[]>(keys.docs, (docs) =>
        docs?.map((item) => (item.id === next.id ? next : item)),
      );
    },
  });
}

/** True when the watch frame is our own save echo or an older revision. */
function isEchoOrStale(incoming?: string, known?: string | null) {
  if (!incoming || !known) return false;
  if (incoming === known) return true;
  const next = Date.parse(incoming);
  const prev = Date.parse(known);
  if (Number.isNaN(next) || Number.isNaN(prev)) return false;
  return next <= prev;
}

export function useDocWatch(
  id: string | undefined,
  options: {
    enabled?: boolean;
    lastSavedAtRef: MutableRefObject<string | null>;
    hasLocalEdits: () => boolean;
    isEditorFocused?: () => boolean;
    onRemote?: () => void;
    onDeleted?: () => void;
  },
) {
  const client = useQueryClient();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!id || options.enabled === false) return;

    return watchDoc(id, (event: DocWatchEvent) => {
      const current = optionsRef.current;
      if (event.type === "hello") return;
      if (event.type === "deleted") {
        client.removeQueries({ queryKey: keys.doc(id) });
        client.invalidateQueries({ queryKey: keys.docs });
        current.onDeleted?.();
        return;
      }
      if (event.type !== "updated") return;
      if (isEchoOrStale(event.updatedAt, current.lastSavedAtRef.current)) return;
      if (current.hasLocalEdits()) return;
      if (event.document) {
        client.setQueryData(keys.doc(id), event.document);
        client.setQueryData<Doc[]>(keys.docs, (docs) =>
          docs?.map((item) => (item.id === id ? (event.document as Doc) : item)),
        );
      } else if (!current.isEditorFocused?.()) {
        client.invalidateQueries({ queryKey: keys.doc(id) });
      } else {
        return;
      }
      if (event.updatedAt) current.lastSavedAtRef.current = event.updatedAt;
      current.onRemote?.();
    });
  }, [id, options.enabled, client]);
}

export function useDeleteDoc() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteDoc,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.docs }),
  });
}

export function useCreateSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createSheet,
    onSuccess: (sheet) => {
      client.setQueryData(keys.sheet(sheet.id), sheet);
      client.invalidateQueries({ queryKey: keys.sheets });
    },
  });
}

export function useUpdateSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateSheet>[1] }) => updateSheet(id, data),
    onSuccess: (sheet) => {
      client.setQueryData(keys.sheet(sheet.id), sheet);
      client.setQueryData<Sheet[]>(keys.sheets, (list) =>
        list?.map((item) => (item.id === sheet.id ? sheet : item)),
      );
    },
  });
}

export function useDeleteSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteSheet,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sheets }),
  });
}

export function useCreateEvent() {
  const invalidate = useInvalidateAll();
  const autoSchedule = useAutoScheduleAfterCreate();
  return useMutation({
    mutationFn: createEvent,
    onSuccess: async () => {
      await invalidate();
      void autoSchedule();
    },
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateEvent>[1] }) =>
      updateEvent(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: deleteEvent, onSuccess: invalidate });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateProject>[1] }) =>
      updateProject(id, data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.projects });
      client.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useCreateStage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      createStage(projectId, name),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateStage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      stageId,
      name,
    }: {
      projectId: string;
      stageId: string;
      name: string;
    }) => updateStage(projectId, stageId, name),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useDeleteStage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, stageId }: { projectId: string; stageId: string }) =>
      deleteStage(projectId, stageId),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useReorderStages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      reorderStages(projectId, ids),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useAddBlock() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Parameters<typeof addTaskBlock>[1] }) =>
      addTaskBlock(taskId, data),
    onSuccess: invalidate,
  });
}

export function useMoveBlock() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: string; end?: string }) =>
      moveBlock(id, { start, end }),
    onSuccess: invalidate,
  });
}

export function useMoveEventTimes() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: string; end: string }) =>
      updateEvent(id, { start, end }),
    onSuccess: invalidate,
  });
}

export function usePreviewSchedule() {
  return useMutation({ mutationFn: previewSchedule });
}

export function useApplySchedule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: applySchedule, onSuccess: invalidate });
}

export function useSaveWorkingHours() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateWorkingHours,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.hours }),
  });
}

export function useAddComment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => addTaskComment(id, comment),
    onSuccess: (_row, vars) => client.invalidateQueries({ queryKey: keys.activity(vars.id) }),
  });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createApiKey,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}

export function useDuplicateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: duplicateTask, onSuccess: invalidate });
}

export function useAddChecklistItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => addChecklistItem(id, title),
    onSuccess: invalidate,
  });
}

export function useToggleChecklistItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      itemId,
      completed,
    }: {
      id: string;
      itemId: string;
      completed: boolean;
    }) => updateChecklistItem(id, itemId, { completed }),
    onSuccess: invalidate,
  });
}

export function useDeleteChecklistItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) => deleteChecklistItem(id, itemId),
    onSuccess: invalidate,
  });
}

export function useStartFocus() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: startFocus, onSuccess: invalidate });
}

export function useStopFocus() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: stopFocus, onSuccess: invalidate });
}

export function useSetTodayFocus() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) => setTodayFocus(id, date),
    onSuccess: invalidate,
  });
}

export function useDuplicateProject() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: duplicateProject, onSuccess: invalidate });
}

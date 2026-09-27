import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getMe, listSessions, revokeOtherSessions, revokeSession } from "./api/auth";
import { getTasks, getTask, updateTask, deleteTask, createTask, captureInbox, getTaskActivity, addTaskComment, editTaskOccurrence, splitTaskSeries, bulkUpdateTasks, duplicateTask, addChecklistItem, updateChecklistItem, deleteChecklistItem, startFocus, pauseFocus, stopFocus, setTodayFocus } from "./api/tasks";
import { getDocs, getDoc, createDoc, updateDoc, deleteDoc, watchDoc, type DocWatchEvent } from "./api/docs";
import type { Doc, MentionEntityType, NotificationSettings, Project, Sheet, Task, TaskViewConfig } from "./types";
import { getSheets, getSheet, createSheet, updateSheet, deleteSheet, duplicateSheet, getSheetTemplates, createSheetTemplate, materializeTemplateTab } from "./api/sheets";
import { getProjects, getProject, createProject, updateProject, deleteProject, createStage, updateStage, deleteStage, reorderStages, duplicateProject, getProjectActivity } from "./api/projects";
import { getWorkspaces, getConfig, updateConfig, updateTaskViewsConfig } from "./api/workspaces";
import {
  addTaskBlock,
  applySchedule,
  clearTaskBlocks,
  deleteBlock,
  getCalendarRange,
  getScheduleSettings,
  getToday,
  getWorkingHours,
  getRank,
  moveBlock,
  pinBlock,
  pinTask,
  previewSchedule,
  undoSchedule,
  updateScheduleSettings,
  updateWorkingHours,
} from "./api/schedule";
import { useScheduleActivity } from "./scheduleActivity";
import { createEvent, deleteEvent, editEventOccurrence, getEvent, splitEventSeries, updateEvent } from "./api/events";
import { searchItems } from "./api/search";
import { listApiKeys, createApiKey, revokeApiKey } from "./api/apiKeys";
import {
  getJobHealth,
  getNotificationSettings,
  listFailedJobs,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  clearNotifications,
  retryJob,
  snoozeNotification,
  prioritizeOverdueTask,
  unreadNotificationCount,
  updateNotificationSettings,
} from "./api/notifications";
import type { UpdateTaskPayload, CreateTaskPayload } from "./api/tasks";

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
  sheetTemplates: ["sheet-templates"] as const,
  projects: ["projects"] as const,
  workspaces: ["workspaces"] as const,
  config: ["config"] as const,
  calendar: (from: string, to: string) => ["calendar", from, to] as const,
  hours: ["working-hours"] as const,
  scheduleSettings: ["schedule-settings"] as const,
  activity: (id: string) => ["task-activity", id] as const,
  search: (q: string) => ["search", q] as const,
  event: (id: string) => ["event", id] as const,
  apiKeys: ["api-keys"] as const,
  inbox: ["tasks", "inbox"] as const,
  rank: ["schedule", "rank"] as const,
  today: ["today"] as const,
  notifications: ["notifications"] as const,
  unreadNotifications: ["notifications", "unread-count"] as const,
  notificationSettings: ["notification-settings"] as const,
  failedJobs: ["jobs", "failed"] as const,
  sessions: ["sessions"] as const,
  projectActivity: (id: string) => ["project-activity", id] as const,
  jobHealth: ["jobs", "health"] as const,
};

function cacheTask(client: QueryClient, task: Task | undefined) {
  if (!task?.id) return;
  client.setQueryData(keys.task(task.id), task);
  client.setQueryData<Task[]>(keys.tasks, (list) => {
    if (!list) return list;
    const index = list.findIndex((item) => item.id === task.id);
    if (index === -1) return [task, ...list];
    const next = list.slice();
    next[index] = { ...list[index], ...task };
    return next;
  });
}

export function useMeQuery() {
  return useQuery({ queryKey: keys.me, queryFn: getMe });
}

export function useTasksQuery() {
  return useQuery({
    queryKey: keys.tasks,
    queryFn: () => getTasks(),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useInboxQuery() {
  return useQuery({ queryKey: keys.inbox, queryFn: () => getTasks({ inbox: true }) });
}

export function useTodayQuery() {
  return useQuery({ queryKey: keys.today, queryFn: () => getToday() });
}

export function useRankQuery() {
  return useQuery({ queryKey: keys.rank, queryFn: getRank, staleTime: 15_000 });
}

export function useTaskQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.task(id ?? ""),
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });
}

export function useDocsQuery() {
  return useQuery({ queryKey: keys.docs, queryFn: getDocs, staleTime: 30_000, placeholderData: keepPreviousData });
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
  return useQuery({ queryKey: keys.sheets, queryFn: getSheets, staleTime: 30_000, placeholderData: keepPreviousData });
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
  return useQuery({ queryKey: keys.projects, queryFn: getProjects, staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useProjectQuery(id?: string) {
  return useQuery({
    queryKey: [...keys.projects, id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });
}

export function useWorkspacesQuery() {
  return useQuery({ queryKey: keys.workspaces, queryFn: getWorkspaces, staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useConfigQuery() {
  return useQuery({ queryKey: keys.config, queryFn: getConfig, staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useUpdateAppearance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (appearance: NonNullable<import("./types").Config["appearance"]>) => updateConfig({ appearance }),
    onSuccess: (config) => {
      client.setQueryData(keys.config, config);
    },
  });
}

export function useUpdateTaskViews() {
  const client = useQueryClient();
  return useMutation({
    scope: { id: "task-view-config" },
    mutationFn: (data: { taskViews: TaskViewConfig[]; activeTaskViewId: string }) => updateTaskViewsConfig(data),
    onSuccess: (config) => {
      client.setQueryData(keys.config, config);
    },
  });
}

export function useCalendarQuery(from: Date, to: Date) {
  return useQuery({
    queryKey: keys.calendar(from.toISOString(), to.toISOString()),
    queryFn: () => getCalendarRange(from, to),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useWorkingHoursQuery() {
  return useQuery({
    queryKey: keys.hours,
    queryFn: getWorkingHours,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
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
      client.invalidateQueries({ queryKey: ["task"] }),
      client.invalidateQueries({ queryKey: ["calendar"] }),
      client.invalidateQueries({ queryKey: keys.docs }),
      client.invalidateQueries({ queryKey: keys.sheets }),
      client.invalidateQueries({ queryKey: keys.projects }),
      client.invalidateQueries({ queryKey: keys.workspaces }),
      client.invalidateQueries({ queryKey: keys.inbox }),
      client.invalidateQueries({ queryKey: keys.rank }),
      client.invalidateQueries({ queryKey: keys.today }),
      client.invalidateQueries({ queryKey: keys.scheduleSettings }),
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

function shouldAutoScheduleAfterCreate(payload: CreateTaskPayload) {
  if (payload.kind === "inbox" || payload.kind === "reminder") return false;
  if (!payload.workspaceId) return false;
  return (payload.duration ?? 0) > 0;
}

export function useSaveTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskPayload }) => updateTask(id, data),
    onMutate: async ({ id, data }) => {
      const previousTask = client.getQueryData<Task>(keys.task(id));
      const previousList = client.getQueryData<Task[]>(keys.tasks);
      const current = previousTask ?? previousList?.find((item) => item.id === id);
      if (current) {
        const next = { ...current, ...data } as Task;
        if (Object.prototype.hasOwnProperty.call(data, "blockedById") && !data.blockedById) {
          next.blockedById = null;
          next.blockedBy = null;
        }
        cacheTask(client, next);
      }
      return { previousTask, previousList };
    },
    onError: (_error, { id }, context) => {
      if (context?.previousTask) client.setQueryData(keys.task(id), context.previousTask);
      if (context?.previousList) client.setQueryData(keys.tasks, context.previousList);
    },
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: ["calendar"] });
      client.invalidateQueries({ queryKey: keys.today });
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
    onSuccess: (task) => {
      cacheTask(client, task);
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
    onSuccess: async (_task, payload) => {
      await invalidate();
      if (shouldAutoScheduleAfterCreate(payload)) void autoSchedule();
    },
  });
}

export function useCaptureInbox() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => captureInbox(name),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.inbox }),
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
    onSuccess: (tasks) => {
      tasks?.forEach((task) => cacheTask(client, task));
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

export function useDuplicateSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: duplicateSheet,
    onSuccess: (sheet) => {
      client.setQueryData(keys.sheet(sheet.id), sheet);
      client.invalidateQueries({ queryKey: keys.sheets });
    },
  });
}

export function useSheetTemplatesQuery() {
  return useQuery({ queryKey: keys.sheetTemplates, queryFn: getSheetTemplates });
}

export function useCreateSheetTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createSheetTemplate,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sheetTemplates }),
  });
}

export function useMaterializeTemplateTab() {
  return useMutation({
    mutationFn: ({ templateId, tabId }: { templateId: string; tabId?: string }) =>
      materializeTemplateTab(templateId, tabId),
  });
}

export function useCreateEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: createEvent,
    onSuccess: invalidate,
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
    onMutate: async ({ id, data }) => {
      const previousList = client.getQueryData<Project[]>(keys.projects);
      const previousOne = client.getQueryData<Project>([...keys.projects, id]);
      client.setQueryData<Project[]>(keys.projects, (list) =>
        list?.map((item) => (item.id === id ? { ...item, ...data } : item)),
      );
      if (previousOne) client.setQueryData([...keys.projects, id], { ...previousOne, ...data });
      return { previousList, previousOne };
    },
    onError: (_error, { id }, context) => {
      if (context?.previousList) client.setQueryData(keys.projects, context.previousList);
      if (context?.previousOne) client.setQueryData([...keys.projects, id], context.previousOne);
    },
    onSuccess: (project) => {
      if (!project?.id) return;
      client.setQueryData([...keys.projects, project.id], project);
      client.setQueryData<Project[]>(keys.projects, (list) =>
        list?.map((item) => (item.id === project.id ? { ...item, ...project } : item)),
      );
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
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: Parameters<typeof addTaskBlock>[1] }) =>
      addTaskBlock(taskId, data),
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: ["calendar"] });
      client.invalidateQueries({ queryKey: keys.today });
    },
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

export function useUndoSchedule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: undoSchedule, onSuccess: invalidate });
}

export function useScheduleSettingsQuery() {
  return useQuery({ queryKey: keys.scheduleSettings, queryFn: getScheduleSettings });
}

export function useSaveScheduleSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateScheduleSettings,
    onSuccess: (settings) => {
      client.setQueryData(keys.scheduleSettings, settings);
    },
  });
}

export function usePinTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, locked }: { taskId: string; locked: boolean }) => pinTask(taskId, locked),
    onSuccess: (task) => cacheTask(client, task),
  });
}

export function usePinBlock() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ blockId, locked }: { blockId: string; locked: boolean }) => pinBlock(blockId, locked),
    onSuccess: invalidate,
  });
}

export function useClearTaskBlocks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => clearTaskBlocks(taskId),
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (blockId: string) => deleteBlock(blockId),
    onSuccess: invalidate,
  });
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
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => addChecklistItem(id, title),
    onSuccess: (task) => cacheTask(client, task),
  });
}

export function useToggleChecklistItem() {
  const client = useQueryClient();
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
    onSuccess: (task) => cacheTask(client, task),
  });
}

export function useDeleteChecklistItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) => deleteChecklistItem(id, itemId),
    onSuccess: (task) => cacheTask(client, task),
  });
}

export function useStartFocus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: startFocus,
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: keys.today });
    },
  });
}

export function useStopFocus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: stopFocus,
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: keys.today });
    },
  });
}

export function usePauseFocus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: pauseFocus,
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: keys.today });
    },
  });
}

export function useSetTodayFocus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) => setTodayFocus(id, date),
    onSuccess: (task) => {
      cacheTask(client, task);
      client.invalidateQueries({ queryKey: keys.today });
    },
  });
}

export function useDuplicateProject() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: duplicateProject, onSuccess: invalidate });
}

export function useProjectActivityQuery(id?: string) {
  return useQuery({
    queryKey: keys.projectActivity(id ?? ""),
    queryFn: () => getProjectActivity(id!),
    enabled: Boolean(id),
  });
}

export function useSessionsQuery() {
  return useQuery({ queryKey: keys.sessions, queryFn: listSessions });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sessions }),
  });
}

export function useRevokeOtherSessions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sessions }),
  });
}

export function useNotificationsQuery(unread = false) {
  return useQuery({
    queryKey: [...keys.notifications, unread] as const,
    queryFn: () => listNotifications(unread),
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: keys.unreadNotifications,
    queryFn: unreadNotificationCount,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.notifications });
      client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.notifications });
      client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function useClearNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearNotifications,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.notifications });
      client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function useSnoozeNotification() {
  const invalidate = useInvalidateAll();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, minutes, until }: { id: string; minutes?: number; until?: string }) =>
      snoozeNotification(id, { minutes, until }),
    onSuccess: () => {
      invalidate();
      client.invalidateQueries({ queryKey: keys.notifications });
      client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function usePrioritizeOverdueTask() {
  const client = useQueryClient();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: prioritizeOverdueTask,
    onSuccess: () => {
      void invalidate().catch(() => undefined);
      void client.invalidateQueries({ queryKey: keys.notifications });
      void client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function useNotificationSettingsQuery() {
  return useQuery({ queryKey: keys.notificationSettings, queryFn: getNotificationSettings });
}

export function useSaveNotificationSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NotificationSettings>) => updateNotificationSettings(data),
    onSuccess: (settings) => client.setQueryData(keys.notificationSettings, settings),
  });
}

export function useFailedJobsQuery() {
  return useQuery({ queryKey: keys.failedJobs, queryFn: listFailedJobs });
}

export function useJobHealthQuery() {
  return useQuery({ queryKey: keys.jobHealth, queryFn: getJobHealth });
}

export function useRetryJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: retryJob,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.failedJobs });
      client.invalidateQueries({ queryKey: keys.jobHealth });
    },
  });
}

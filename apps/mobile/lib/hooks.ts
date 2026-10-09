import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getMe, listSessions, revokeOtherSessions, revokeSession } from "./api/auth";
import { getTasks, getTask, updateTask, deleteTask, createTask, captureInbox, getTaskActivity, addTaskComment, editTaskOccurrence, splitTaskSeries, bulkUpdateTasks, duplicateTask, addChecklistItem, updateChecklistItem, deleteChecklistItem, startFocus, pauseFocus, stopFocus, setTodayFocus } from "./api/tasks";
import { getDocs, getDoc, getDocBacklinks, createDoc, updateDoc, deleteDoc, watchDoc, type DocWatchEvent } from "./api/docs";
import type { Doc, MentionEntityType, NotificationSettings, Project, Sheet, SheetTemplate, Task, TaskViewConfig } from "./types";
import { getSheets, getSheet, createSheet, updateSheet, deleteSheet, duplicateSheet, getSheetTemplates, createSheetTemplate, updateSheetTemplate, deleteSheetTemplate, materializeTemplateTab } from "./api/sheets";
import { getProjects, getProject, createProject, updateProject, deleteProject, createStage, updateStage, deleteStage, reorderStages, duplicateProject, getProjectActivity } from "./api/projects";
import { getWorkspaces, getConfig, updateConfig, updateTaskViewsConfig } from "./api/workspaces";
import {
  addTaskBlock,
  applySchedule,
  clearTaskBlocks,
  deleteBlock,
  getCalendarRange,
  getFreeTime,
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
import { relatedItems, searchItems, smartSearch, type RelatedKind } from "./api/search";
import { listApiKeys, createApiKey, revokeApiKey } from "./api/apiKeys";
import {
  connectProvider,
  disconnectProvider,
  getAgentProviders,
  listProviderModels,
  patchAgentProviders,
  removeApiProviderKey,
  removeOpenRouterKey,
  setApiProviderKey,
  setOpenRouterKey,
  type AgentProviders,
  type ApiProviderId,
  type ProviderId,
  type ProviderPatch,
} from "./api/agentProviders";
import {
  getDecisionSettings,
  getDecisionsStatus,
  getInboxSuggestions,
  getDocHints,
  getTodaySuggestions,
  runNotificationTriage,
  type TriageStep,
  getProjectInsights,
  getStaleWork,
  getTaskHints,
  keepStaleTask,
  patchDecisionSettings,
  removeTypeSafeKey,
  sendDecisionFeedback,
  setTypeSafeKey,
  type DecisionSettings,
} from "./api/decisions";
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
import type { UpdateTaskPayload, CreateTaskPayload, SplitTaskSeriesPayload } from "./api/tasks";
import type { SplitEventSeriesPayload } from "./api/events";

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
  smartSearch: (q: string) => ["smart-search", q] as const,
  related: (kind: string, id: string) => ["related", kind, id] as const,
  event: (id: string) => ["event", id] as const,
  apiKeys: ["api-keys"] as const,
  agentProviders: ["agent-providers"] as const,
  decisions: ["decisions"] as const,
  decisionSettings: ["decisions", "settings"] as const,
  decisionsStatus: ["decisions", "status"] as const,
  inboxSuggestions: (id: string) => ["inbox-suggestions", id] as const,
  taskHints: (id: string, version: string) => ["task-hints", id, version] as const,
  staleWork: ["stale-work"] as const,
  projectInsights: (id: string, version: string) => ["project-insights", id, version] as const,
  docHints: (id: string, version: string) => ["doc-hints", id, version] as const,
  todaySuggestions: (timezone: string, version: string) => ["today-suggestions", timezone, version] as const,
  inbox: ["tasks", "inbox"] as const,
  rank: ["schedule", "rank"] as const,
  freeTime: ["schedule", "free-time"] as const,
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

/** Free Working hours from `from` to `to`; fetch only while `enabled`. */
export function useFreeTimeQuery(from: Date, to: Date, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.freeTime, from.toISOString(), to.toISOString()],
    queryFn: () => getFreeTime(from, to),
    enabled,
  });
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

/** Docs linking to this one; under the docs key so saves refresh it. */
export function useDocBacklinksQuery(id: string) {
  return useQuery({ queryKey: [...keys.doc(id), "backlinks"], queryFn: () => getDocBacklinks(id), enabled: Boolean(id) });
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

/**
 * The Working hours timezone: the zone the server judges Overdue and
 * Unscheduled in. Undefined (device zone) until config loads or when none is
 * saved.
 */
export function useWorkingHoursZone(): string | undefined {
  const { data } = useConfigQuery();
  return data?.workingHours?.timezone || undefined;
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

export function useCalendarQuery(from: Date, to: Date, enabled = true) {
  return useQuery({
    queryKey: keys.calendar(from.toISOString(), to.toISOString()),
    queryFn: () => getCalendarRange(from, to),
    enabled,
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
  const result = useQuery({
    queryKey: keys.search(trimmed),
    queryFn: () => searchItems(trimmed),
    enabled: trimmed.length > 0,
  });
  return { ...result, query: trimmed };
}

/**
 * Smart suggestions' take on a search. Pass the `query` useSearchQuery
 * returns (already debounced and trimmed) so both run on the same text.
 * Nothing is requested while Smart suggestions are off.
 */
export function useSmartSearchQuery(debouncedQuery: string, enabled = true) {
  const query = debouncedQuery.trim();
  const status = useDecisionsStatusQuery(enabled && query.length >= 2);
  const result = useQuery({
    queryKey: keys.smartSearch(query),
    queryFn: () => smartSearch(query),
    enabled: enabled && query.length >= 2 && status.data?.available === true,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { ...result, query };
}

/** Items related to one task, project, doc or sheet; quiet while Smart suggestions are off. */
export function useRelatedQuery(kind: RelatedKind, id: string | undefined, enabled = true) {
  const status = useDecisionsStatusQuery(enabled && !!id);
  return useQuery({
    queryKey: keys.related(kind, id ?? ""),
    queryFn: () => relatedItems(kind, id ?? ""),
    enabled: enabled && !!id && status.data?.available === true,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useApiKeysQuery() {
  return useQuery({ queryKey: keys.apiKeys, queryFn: listApiKeys });
}

export function useAgentProvidersQuery() {
  return useQuery({
    queryKey: keys.agentProviders,
    queryFn: getAgentProviders,
    // Poll while the semantic-search rebuild runs so the count moves.
    refetchInterval: (query) => {
      const status = query.state.data?.reindex?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    },
  });
}

export function useProviderModelsQuery(id: ProviderId, kind?: "embed", enabled = true) {
  return useQuery({
    queryKey: [...keys.agentProviders, "models", id, kind ?? "chat"] as const,
    queryFn: () => listProviderModels(id, kind),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

function useAgentProviderMutation<TVars>(fn: (vars: TVars) => Promise<AgentProviders>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => client.setQueryData(keys.agentProviders, data),
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.agentProviders, exact: true });
      // Smart suggestions fall back to the OpenRouter key.
      client.invalidateQueries({ queryKey: keys.decisions });
    },
  });
}

export const usePatchAgentProviders = () =>
  useAgentProviderMutation((patch: ProviderPatch) => patchAgentProviders(patch));
export const useConnectProvider = () =>
  useAgentProviderMutation((id: "claude" | "codex") => connectProvider(id));
export const useDisconnectProvider = () =>
  useAgentProviderMutation((id: "claude" | "codex") => disconnectProvider(id));
export const useSetOpenRouterKey = () => useAgentProviderMutation((key: string) => setOpenRouterKey(key));
export const useRemoveOpenRouterKey = () => useAgentProviderMutation<void>(() => removeOpenRouterKey());
export const useSetApiProviderKey = () =>
  useAgentProviderMutation((vars: { id: ApiProviderId; key: string; baseUrl?: string }) =>
    setApiProviderKey(vars.id, vars.key, vars.baseUrl),
  );
export const useRemoveApiProviderKey = () =>
  useAgentProviderMutation((id: ApiProviderId) => removeApiProviderKey(id));

export function useDecisionSettingsQuery() {
  return useQuery({ queryKey: keys.decisionSettings, queryFn: getDecisionSettings, retry: false });
}

function useDecisionSettingsMutation<TVars>(fn: (vars: TVars) => Promise<DecisionSettings>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => client.setQueryData(keys.decisionSettings, data),
    onSettled: () => client.invalidateQueries({ queryKey: keys.decisions }),
  });
}

export const usePatchDecisionSettings = () =>
  useDecisionSettingsMutation((enabled: boolean) => patchDecisionSettings(enabled));
export const useSetTypeSafeKey = () => useDecisionSettingsMutation((key: string) => setTypeSafeKey(key));
export const useRemoveTypeSafeKey = () => useDecisionSettingsMutation<void>(() => removeTypeSafeKey());

/** Whether smart suggestions can run. Fails quietly: an older server without
 * the endpoint just means no suggestions. */
export function useDecisionsStatusQuery(enabled = true) {
  return useQuery({ queryKey: keys.decisionsStatus, queryFn: getDecisionsStatus, enabled, retry: false, staleTime: 60_000 });
}

/** One model call per item: kept for the session and never retried. */
export function useInboxSuggestionsQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.inboxSuggestions(id ?? ""),
    queryFn: () => getInboxSuggestions(id!),
    enabled: Boolean(id) && enabled,
    retry: false,
    staleTime: Infinity,
  });
}

/** Hints from a task's own words; asked again when `version` changes. */
export function useTaskHintsQuery(id: string | undefined, version: string, enabled = true) {
  const status = useDecisionsStatusQuery(enabled && !!id);
  return useQuery({
    queryKey: keys.taskHints(id ?? "", version),
    queryFn: () => getTaskHints(id!),
    enabled: enabled && !!id && status.data?.available === true,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** Open Work with no activity for three weeks, with what each likely needs. */
export function useStaleWorkQuery(enabled = true) {
  const status = useDecisionsStatusQuery(enabled);
  return useQuery({
    queryKey: keys.staleWork,
    queryFn: getStaleWork,
    enabled: enabled && status.data?.available === true,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });
}

export function useKeepStaleTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: keepStaleTask,
    onSuccess: (_data, id) =>
      client.setQueryData(keys.staleWork, (old: { tasks: { id: string }[] } | undefined) =>
        old ? { ...old, tasks: old.tasks.filter((task) => task.id !== id) } : old,
      ),
  });
}

export function useProjectInsightsQuery(id: string | undefined, version: string) {
  const status = useDecisionsStatusQuery(!!id);
  return useQuery({
    queryKey: keys.projectInsights(id ?? "", version),
    queryFn: () => getProjectInsights(id!),
    enabled: !!id && status.data?.available === true,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDocHintsQuery(id: string | undefined, version: string, enabled = true) {
  const status = useDecisionsStatusQuery(!!id && enabled);
  return useQuery({
    queryKey: keys.docHints(id ?? "", version),
    queryFn: () => getDocHints(id!),
    enabled: !!id && enabled && status.data?.available === true,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** Today's focus picks and free-gap suggestion; version changes when the
 * focus list or agenda changes. */
export function useTodaySuggestionsQuery(timezone: string, version: string, enabled = true) {
  const status = useDecisionsStatusQuery(enabled);
  return useQuery({
    queryKey: keys.todaySuggestions(timezone, version),
    queryFn: () => getTodaySuggestions(timezone),
    enabled: enabled && status.data?.available === true,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useNotificationTriage() {
  const client = useQueryClient();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TriageStep }) => runNotificationTriage(id, action),
    onSuccess: () => {
      void invalidate().catch(() => undefined);
      void client.invalidateQueries({ queryKey: keys.notifications });
      void client.invalidateQueries({ queryKey: keys.unreadNotifications });
    },
  });
}

export function useDecisionFeedback() {
  return useMutation({
    mutationFn: ({ logId, accepted }: { logId: string; accepted: boolean }) => sendDecisionFeedback(logId, accepted),
  });
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
      client.invalidateQueries({ queryKey: keys.freeTime }),
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
      client.invalidateQueries({ queryKey: keys.freeTime });
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
      client.invalidateQueries({ queryKey: keys.freeTime });
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
      recurrence?: SplitTaskSeriesPayload["recurrence"];
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
      recurrence?: SplitEventSeriesPayload["recurrence"];
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
      client.invalidateQueries({ queryKey: keys.freeTime });
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

export function useUpdateSheetTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateSheetTemplate>[1] }) =>
      updateSheetTemplate(id, data),
    onSuccess: (template) => {
      client.setQueryData<SheetTemplate[]>(keys.sheetTemplates, (list) =>
        list?.map((item) => (item.id === template.id ? template : item)),
      );
    },
  });
}

export function useDeleteSheetTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteSheetTemplate,
    onSuccess: (_result, id) => {
      client.setQueryData<SheetTemplate[]>(keys.sheetTemplates, (list) =>
        list?.filter((item) => item.id !== id),
      );
    },
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
      const patch = data;
      client.setQueryData<Project[]>(keys.projects, (list) =>
        list?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      if (previousOne) client.setQueryData([...keys.projects, id], { ...previousOne, ...patch });
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
      client.invalidateQueries({ queryKey: keys.freeTime });
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
      client.invalidateQueries({ queryKey: keys.freeTime });
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

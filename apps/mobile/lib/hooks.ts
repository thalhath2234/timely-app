import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "./api/auth";
import { getTasks, updateTask, deleteTask, createTask, getTaskActivity, addTaskComment } from "./api/tasks";
import { getDocs, getDoc, createDoc, updateDoc, deleteDoc } from "./api/docs";
import { getSheets, getSheet, createSheet, updateSheet, deleteSheet } from "./api/sheets";
import { getProjects, createProject } from "./api/projects";
import { getWorkspaces, getConfig } from "./api/workspaces";
import {
  addTaskBlock,
  applySchedule,
  getCalendarRange,
  getWorkingHours,
  moveBlock,
  previewSchedule,
  updateWorkingHours,
} from "./api/schedule";
import { createEvent, updateEvent, deleteEvent } from "./api/events";
import { searchItems } from "./api/search";
import { listApiKeys, createApiKey, revokeApiKey } from "./api/apiKeys";
import type { UpdateTaskPayload } from "./api/tasks";
import type { Sheet } from "./types";

export const keys = {
  me: ["me"] as const,
  tasks: ["tasks"] as const,
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
  apiKeys: ["api-keys"] as const,
};

export function useMeQuery() {
  return useQuery({ queryKey: keys.me, queryFn: getMe });
}

export function useTasksQuery() {
  return useQuery({ queryKey: keys.tasks, queryFn: getTasks });
}

export function useDocsQuery() {
  return useQuery({ queryKey: keys.docs, queryFn: getDocs });
}

export function useDocQuery(id: string) {
  return useQuery({ queryKey: keys.doc(id), queryFn: () => getDoc(id), enabled: Boolean(id) });
}

export function useSheetsQuery() {
  return useQuery({ queryKey: keys.sheets, queryFn: getSheets });
}

export function useSheetQuery(id: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.sheet(id),
    queryFn: () => getSheet(id),
    enabled: Boolean(id),
    placeholderData: () => client.getQueryData<Sheet[]>(keys.sheets)?.find((sheet) => sheet.id === id),
  });
}

export function useProjectsQuery() {
  return useQuery({ queryKey: keys.projects, queryFn: getProjects });
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

export function useSearchQuery(query: string) {
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => searchItems(query),
    enabled: query.trim().length > 0,
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
    ]);
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

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: createTask, onSuccess: invalidate });
}

export function useDeleteTask() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: deleteTask, onSuccess: invalidate });
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
    onSuccess: (next, vars) => {
      client.setQueryData(keys.doc(vars.id), next);
      client.invalidateQueries({ queryKey: keys.docs });
    },
  });
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
  return useMutation({ mutationFn: createEvent, onSuccess: invalidate });
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

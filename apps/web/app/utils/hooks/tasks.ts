import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTaskComment,
  createTask,
  deleteTask,
  editTaskOccurrence,
  UpdateTaskPayload,
  getTask,
  getTaskActivity,
  getTasks,
  bulkUpdateTasks,
  splitTaskSeries,
  updateTask,
  duplicateTask,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  startFocus,
  stopFocus,
  setTodayFocus,
  type CreateTaskPayload,
  type SplitTaskSeriesPayload,
  type TaskOccurrencePayload,
} from "@/app/utils/api/tasks";
import { Label, Task, TaskActivity } from "@/app/_types/types";

export const tasksKey = ["tasks"] as const;
export const inboxKey = ["tasks", "inbox"] as const;
export const todayKey = ["today"] as const;

export function taskKey(id: string) {
  return ["task", id] as const;
}

export function useTasks() {
  return useQuery({
    queryKey: tasksKey,
    queryFn: () => getTasks(),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: taskKey(id ?? ""),
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTaskPayload) => createTask(data),
    // Creating work never re-plans the calendar on its own: the user reviews
    // and accepts a plan through the explicit Auto-schedule dialog.
    onSuccess: async (created, variables) => {
      const parentId = variables.parentTaskId;
      if (parentId) {
        queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
          tasks?.map((item) =>
            item.id === parentId
              ? {
                  ...item,
                  subtasks: [...(item.subtasks ?? []), created],
                  subtaskCount: (item.subtaskCount ?? 0) + 1,
                  openSubtaskCount: (item.openSubtaskCount ?? 0) + 1,
                }
              : item,
          ),
        );
        queryClient.setQueryData<Task>(taskKey(parentId), (parent) =>
          parent
            ? {
                ...parent,
                subtasks: [...(parent.subtasks ?? []), created],
                subtaskCount: (parent.subtaskCount ?? 0) + 1,
                openSubtaskCount: (parent.openSubtaskCount ?? 0) + 1,
              }
            : parent,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tasksKey }),
        queryClient.invalidateQueries({ queryKey: inboxKey }),
        queryClient.invalidateQueries({ queryKey: todayKey }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        parentId
          ? queryClient.invalidateQueries({ queryKey: taskKey(parentId) })
          : Promise.resolve(),
      ]);
    },
  });
}

/** Patch one task in the list cache (optimistic label toggles, etc.). */
export function patchTaskInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  patch: Partial<Task>,
) {
  queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
    tasks?.map((item) => (item.id === taskId ? { ...item, ...patch } : item)),
  );
}

function mergeTaskUpdate(item: Task, task: Task): Task {
  const merged: Task = { ...item, ...task };

  if (task.labelIds !== undefined) {
    merged.labelIds = task.labelIds ?? [];
    if (Array.isArray(task.labels)) {
      merged.labels = task.labels;
    } else if (merged.labelIds.length === 0) {
      merged.labels = [];
    } else {
      const known = new Map<string, Label>();
      for (const label of item.labels ?? []) known.set(label.id, label);
      merged.labels = merged.labelIds
        .map((ref) => known.get(ref.id))
        .filter((label): label is Label => label != null);
    }
  } else if (Array.isArray(task.labels)) {
    merged.labels = task.labels;
  }

  return merged;
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateTaskPayload & { id: string }) =>
      updateTask(id, payload),
    // Autosave fires often, so the cache is patched in place rather than
    // refetching every task on each keystroke batch.
    onSuccess: (task, variables) => {
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) => {
        if (!tasks) return tasks;
        const present = tasks.some((item) => item.id === task.id);
        // An inbox item that just became work is not in the board cache yet;
        // add it so the user sees it land without a refetch.
        if (!present && task.kind !== "inbox") return [...tasks, task];
        return tasks.map((item) => (item.id === task.id ? mergeTaskUpdate(item, task) : item));
      });
      queryClient.setQueryData<Task>(taskKey(task.id), (current) =>
        current ? mergeTaskUpdate(current, task) : task,
      );
      // Clarified items leave the Inbox immediately; the list must not wait
      // for a background refetch to drop the processed row.
      queryClient.setQueryData<Task[]>(inboxKey, (items) => {
        if (!items) return items;
        if (task.kind === "inbox") {
          return items.map((item) => (item.id === task.id ? mergeTaskUpdate(item, task) : item));
        }
        return items.filter((item) => item.id !== task.id);
      });
      queryClient.invalidateQueries({ queryKey: taskActivityKey(task.id) });
      // Schedule, duration and recurrence edits all change calendar time.
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      if (
        variables.kind !== undefined ||
        variables.completedAt !== undefined ||
        variables.todayFocusOn !== undefined ||
        variables.scheduledOn !== undefined
      ) {
        queryClient.invalidateQueries({ queryKey: todayKey });
        queryClient.invalidateQueries({ queryKey: inboxKey });
      }
    },
  });
}

/** Complete / skip / move one instance of a recurring task. */
export function useEditTaskOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: TaskOccurrencePayload & { id: string }) =>
      editTaskOccurrence(id, payload),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
        tasks?.map((item) => (item.id === task.id ? { ...item, ...task } : item)),
      );
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: taskActivityKey(task.id) });
    },
  });
}

/** "This and future" edit on a recurring task; returns the new series. */
export function useSplitTaskSeries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: SplitTaskSeriesPayload & { id: string }) =>
      splitTaskSeries(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tasksKey });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export function taskActivityKey(taskId: string) {
  return ["task-activity", taskId] as const;
}

export function useTaskActivity(taskId: string, enabled = true) {
  return useQuery({
    queryKey: taskActivityKey(taskId),
    queryFn: () => getTaskActivity(taskId),
    enabled: enabled && Boolean(taskId),
  });
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, update }: { ids: string[]; update: UpdateTaskPayload }) =>
      bulkUpdateTasks(ids, update),
    onSuccess: (tasks) => {
      queryClient.setQueryData<Task[]>(tasksKey, (current) => {
        if (!current) return tasks;
        const byId = new Map(tasks.map((task) => [task.id, task]));
        return current.map((item) => {
          const next = byId.get(item.id);
          return next ? mergeTaskUpdate(item, next) : item;
        });
      });
      for (const task of tasks) {
        queryClient.setQueryData<Task>(taskKey(task.id), (current) =>
          current ? mergeTaskUpdate(current, task) : current,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
        tasks?.filter((item) => item.id !== id),
      );
      queryClient.setQueryData<Task[]>(inboxKey, (items) =>
        items?.filter((item) => item.id !== id),
      );
      queryClient.removeQueries({ queryKey: taskKey(id) });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: todayKey });
      queryClient.invalidateQueries({ queryKey: inboxKey });
    },
  });
}

export function useAddTaskComment(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (comment: string) => addTaskComment(taskId, comment),
    onSuccess: (entry) => {
      queryClient.setQueryData<TaskActivity[]>(
        taskActivityKey(taskId),
        (entries) => [entry, ...(entries ?? [])],
      );
    },
  });
}

export function useInboxTasks() {
  return useQuery({
    queryKey: inboxKey,
    queryFn: () => getTasks({ inbox: true }),
  });
}

function invalidateExecution(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId?: string,
) {
  queryClient.invalidateQueries({ queryKey: tasksKey });
  queryClient.invalidateQueries({ queryKey: inboxKey });
  queryClient.invalidateQueries({ queryKey: todayKey });
  queryClient.invalidateQueries({ queryKey: ["calendar"] });
  if (taskId) queryClient.invalidateQueries({ queryKey: taskKey(taskId) });
}

export function useDuplicateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: duplicateTask,
    onSuccess: (task) => invalidateExecution(queryClient, task.id),
  });
}

export function useAddChecklistItem(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => addChecklistItem(taskId, title),
    onSuccess: () => invalidateExecution(queryClient, taskId),
  });
}

export function useToggleChecklistItem(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      updateChecklistItem(taskId, itemId, { completed }),
    onSuccess: () => invalidateExecution(queryClient, taskId),
  });
}

export function useDeleteChecklistItem(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteChecklistItem(taskId, itemId),
    onSuccess: () => invalidateExecution(queryClient, taskId),
  });
}

export function useStartFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startFocus,
    onSuccess: (task) => invalidateExecution(queryClient, task.id),
  });
}

export function useStopFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopFocus,
    onSuccess: (task) => invalidateExecution(queryClient, task.id),
  });
}

export function useSetTodayFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, date }: { taskId: string; date: string | null }) =>
      setTodayFocus(taskId, date),
    onSuccess: (task) => invalidateExecution(queryClient, task.id),
  });
}

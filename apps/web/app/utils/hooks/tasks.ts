import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTaskComment,
  deleteTask,
  editTaskOccurrence,
  UpdateTaskPayload,
  getTaskActivity,
  getTasks,
  splitTaskSeries,
  updateTask,
  type SplitTaskSeriesPayload,
  type TaskOccurrencePayload,
} from "@/app/utils/api/tasks";
import { Label, Task, TaskActivity } from "@/app/_types/types";

export const tasksKey = ["tasks"] as const;

export function useTasks() {
  return useQuery({
    queryKey: tasksKey,
    queryFn: getTasks,
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
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
        tasks?.map((item) =>
          item.id === task.id ? mergeTaskUpdate(item, task) : item,
        ),
      );
      queryClient.invalidateQueries({ queryKey: taskActivityKey(task.id) });
      // Schedule, duration and recurrence edits all change calendar time.
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
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

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Task[]>(tasksKey, (tasks) =>
        tasks?.filter((item) => item.id !== id),
      );
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
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

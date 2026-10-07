import type { Task, TaskActivity } from "@/app/_types/types";
import type {
  CreateTaskPayload,
  SplitTaskSeriesPayload,
  TaskOccurrenceAction,
  TaskOccurrencePayload,
  UpdateTaskPayload,
} from "@timely/contract/entities";
import { apiFetch } from "./client";

export type {
  CreateTaskPayload,
  SplitTaskSeriesPayload,
  TaskOccurrenceAction,
  TaskOccurrencePayload,
  UpdateTaskPayload,
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/** Page size used when walking the task list. The API defaults to 200 and
 * silently truncates, so the loader keeps asking for the next offset until a
 * short page comes back. */
const TASK_PAGE_SIZE = 500;
/** Hard stop so a misbehaving server can never make the loader spin forever. */
const TASK_PAGE_LIMIT = 100;

export async function getTasks(query: {
  kind?: string;
  inbox?: boolean;
  reminders?: boolean;
} = {}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.inbox) params.set("inbox", "true");
  if (query.reminders) params.set("reminders", "true");
  params.set("limit", String(TASK_PAGE_SIZE));

  const all: Task[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < TASK_PAGE_LIMIT; page += 1) {
    params.set("offset", String(page * TASK_PAGE_SIZE));
    const response = await apiFetch(`/tasks?${params.toString()}`, {});
    if (!response.ok) {
      throw new Error(await readError(response, "Failed to fetch tasks"));
    }
    const batch = (await response.json()) as Task[] | null;
    const items = Array.isArray(batch) ? batch : [];
    for (const task of items) {
      // Dedupe defensively: a create between two page requests can shift
      // offsets and repeat the boundary record.
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      all.push(task);
    }
    if (items.length < TASK_PAGE_SIZE) break;
  }
  return all;
}

export async function getTask(id: string): Promise<Task> {
  const response = await apiFetch(`/task/${id}`, {});

  if (!response.ok) {
    throw new Error("Failed to fetch task");
  }

  return response.json();
}

export async function createTask(data: CreateTaskPayload): Promise<Task> {
  const response = await apiFetch("/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create task"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function captureInbox(name: string): Promise<Task> {
  const response = await apiFetch("/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to capture"));
  }
  const resData = await response.json();
  return resData.task ?? resData;
}

export async function clarifyInbox(
  inboxId: string,
  data: CreateTaskPayload,
): Promise<Task> {
  const response = await apiFetch(`/inbox/${inboxId}/clarify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to clarify"));
  }
  const resData = await response.json();
  return resData.task ?? resData;
}

/** Edits one instance of a recurring task without touching the series. */
export async function editTaskOccurrence(
  taskId: string,
  data: TaskOccurrencePayload,
): Promise<Task> {
  const response = await apiFetch(
    `/tasks/${taskId}/occurrences`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update occurrence"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

/** "This and future": closes the series before `fromStart` and returns the new task. */
export async function splitTaskSeries(
  taskId: string,
  data: SplitTaskSeriesPayload,
): Promise<Task> {
  const response = await apiFetch(
    `/tasks/${taskId}/recurrence/split`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to split series"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function updateTask(
  id: string,
  data: UpdateTaskPayload,
): Promise<Task> {
  const response = await apiFetch(`/tasks/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update task"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function deleteTask(id: string): Promise<void> {
  const response = await apiFetch(`/tasks/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete task"));
  }
}

export async function bulkUpdateTasks(
  ids: string[],
  update: UpdateTaskPayload,
): Promise<Task[]> {
  const response = await apiFetch("/tasks/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, update }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update tasks"));
  }
  const resData = await response.json();
  return resData.tasks ?? resData;
}

export async function getTaskActivity(taskId: string): Promise<TaskActivity[]> {
  const response = await apiFetch(
    `/tasks/${taskId}/activity`,
    {},
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load activity"));
  }

  return response.json();
}

export async function addTaskComment(
  taskId: string,
  comment: string,
): Promise<TaskActivity> {
  const response = await apiFetch(
    `/tasks/${taskId}/activity`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to add comment"));
  }

  return response.json();
}

async function unwrapTask(response: Response, fallback: string): Promise<Task> {
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  const data = await response.json();
  return data.task ?? data;
}

export async function duplicateTask(id: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${id}/duplicate`, { method: "POST" });
  return unwrapTask(response, "Failed to duplicate task");
}

export async function addChecklistItem(taskId: string, title: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return unwrapTask(response, "Failed to add checklist item");
}

export async function updateChecklistItem(
  taskId: string,
  itemId: string,
  data: { title?: string; completed?: boolean },
): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return unwrapTask(response, "Failed to update checklist item");
}

export async function deleteChecklistItem(taskId: string, itemId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "DELETE",
  });
  return unwrapTask(response, "Failed to delete checklist item");
}

export async function startFocus(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/focus/start`, { method: "POST" });
  return unwrapTask(response, "Failed to start focus");
}

export async function stopFocus(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/focus/stop`, { method: "POST" });
  return unwrapTask(response, "Failed to stop focus");
}

export async function setTodayFocus(taskId: string, date: string | null): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/today-focus`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  return unwrapTask(response, "Failed to update today focus");
}
